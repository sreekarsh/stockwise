import gymnasium as gym
from gymnasium import spaces
import numpy as np

class TradingEnv(gym.Env):
    metadata = {"render_modes": ["human"]}
    
    def __init__(self, X: np.ndarray, prices: np.ndarray, initial_balance: float = 10000.0, transaction_cost_pct: float = 0.001):
        super(TradingEnv, self).__init__()
        self.X = X
        self.prices = prices
        self.initial_balance = initial_balance
        self.transaction_cost_pct = transaction_cost_pct
        
        self.n_samples = len(prices)
        self.current_step = 0
        
        # Action space: 0 = Hold, 1 = Buy Long, 2 = Sell Short
        self.action_space = spaces.Discrete(3)
        
        # Observation space: 50 features + position state (1 = Long, -1 = Short, 0 = None) + floating P&L
        self.observation_space = spaces.Box(
            low=-np.inf,
            high=np.inf,
            shape=(50 + 2,),
            dtype=np.float32
        )
        
        self.reset()
        
    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        self.current_step = 0
        self.balance = self.initial_balance
        self.position = 0  # 0 = none, 1 = long, -1 = short
        self.entry_price = self.prices[0] if len(self.prices) > 0 else 0.0
        self.equity = self.initial_balance
        self.equity_history = [self.initial_balance]
        
        info = {}
        return self._get_obs(), info
        
    def _get_obs(self):
        if self.current_step >= self.n_samples:
            feats = self.X[-1]
            price = self.prices[-1]
        else:
            feats = self.X[self.current_step]
            price = self.prices[self.current_step]
            
        # Calculate floating P&L
        floating_pnl = 0.0
        if self.position == 1 and self.entry_price > 0:
            floating_pnl = (price - self.entry_price) / self.entry_price
        elif self.position == -1 and self.entry_price > 0:
            floating_pnl = (self.entry_price - price) / self.entry_price
            
        obs = np.concatenate([
            feats,
            np.array([float(self.position), float(floating_pnl)], dtype=np.float32)
        ])
        return obs.astype(np.float32)
        
    def step(self, action):
        if self.current_step >= self.n_samples - 1:
            obs = self._get_obs()
            return obs, 0.0, True, False, {"equity": self.equity}
            
        current_price = self.prices[self.current_step]
        
        # Execute action
        pnl = 0.0
        cost = self.transaction_cost_pct
        if action == 1:  # Buy Long
            if self.position == -1:
                # Close short
                pnl = (self.entry_price - current_price) / self.entry_price if self.entry_price > 0 else 0.0
                self.balance += self.balance * (pnl - cost)
                self.position = 0
            if self.position == 0:
                self.balance -= self.balance * cost
                self.position = 1
                self.entry_price = current_price
        elif action == 2:  # Sell Short
            if self.position == 1:
                # Close long
                pnl = (current_price - self.entry_price) / self.entry_price if self.entry_price > 0 else 0.0
                self.balance += self.balance * (pnl - cost)
                self.position = 0
            if self.position == 0:
                self.balance -= self.balance * cost
                self.position = -1
                self.entry_price = current_price
        # Action 0 = Hold: keep current position
        
        # Advance step
        self.current_step += 1
        next_price = self.prices[self.current_step]
        
        # Calculate current equity
        floating_pnl = 0.0
        if self.position == 1 and self.entry_price > 0:
            floating_pnl = (next_price - self.entry_price) / self.entry_price
        elif self.position == -1 and self.entry_price > 0:
            floating_pnl = (self.entry_price - next_price) / self.entry_price
            
        current_equity = self.balance * (1.0 + floating_pnl)
        self.equity_history.append(current_equity)
        
        # Reward: log return of equity
        prev_equity = self.equity_history[-2]
        step_return = (current_equity - prev_equity) / (prev_equity + 1e-12)
        # Numerical stability check for log
        log_return = float(np.log(max(1e-5, 1.0 + step_return)))
        
        # Sharpe penalty for drawdown
        peak_equity = max(self.equity_history)
        drawdown = (peak_equity - current_equity) / (peak_equity + 1e-12)
        drawdown_penalty = 0.05 * drawdown if drawdown > 0.05 else 0.0
        
        reward = log_return - drawdown_penalty
        
        # Termination conditions
        terminated = self.current_step >= self.n_samples - 1
        truncated = False
        
        if current_equity <= self.initial_balance * 0.1:
            terminated = True
            
        info = {
            "equity": current_equity,
            "balance": self.balance,
            "position": self.position,
            "pnl": floating_pnl
        }
        
        self.equity = current_equity
        return self._get_obs(), float(reward), terminated, truncated, info
