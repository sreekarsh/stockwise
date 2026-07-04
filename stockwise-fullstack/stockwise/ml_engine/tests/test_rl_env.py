from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

import numpy as np
from rl_env import TradingEnv


def _make_env(prices_arr, cost=0.001):
    # X must have 50 feature columns to match expected obs dims
    n = len(prices_arr)
    X = np.zeros((n, 50))
    X[:, 0] = prices_arr
    return TradingEnv(X, prices_arr, transaction_cost_pct=cost)


def test_env_reset():
    prices = np.cumprod(1 + np.random.randn(1000) * 0.01) * 100
    env = _make_env(prices)
    obs, info = env.reset()
    assert len(obs) == 52


def test_env_step():
    prices = np.cumprod(1 + np.random.randn(1000) * 0.01) * 100
    env = _make_env(prices)
    env.reset()
    obs, reward, terminated, truncated, info = env.step(0)
    assert len(obs) == 52
    assert isinstance(reward, float)
    assert isinstance(terminated, bool)


def test_env_hold():
    prices = np.array([100.0, 100.5, 101.0])
    env = _make_env(prices)
    env.reset()
    obs, _, _, _, _ = env.step(1)
    assert env.position == 1
    obs, _, _, _, _ = env.step(0)
    assert env.position == 1


def test_env_transaction_cost():
    prices = np.array([100.0, 101.0, 102.0, 103.0])
    env = _make_env(prices, cost=0.01)
    env.reset()
    env.step(1)
    assert env.balance < 10000.0
    bal = env.balance
    env.step(2)
    assert env.balance != bal
