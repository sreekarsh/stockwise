import os
import math
import torch
import torch.nn as nn
import torch.optim as optim
import numpy as np
from typing import Dict, Any, List, Tuple

MODEL_PATH = os.path.join(os.path.dirname(__file__), "lstm_model.pt")

class LSTMClassifier(nn.Module):
    def __init__(self, input_dim: int = 50, hidden_dim: int = 64, num_layers: int = 2, output_dim: int = 3):
        super(LSTMClassifier, self).__init__()
        self.hidden_dim = hidden_dim
        self.num_layers = num_layers
        self.lstm = nn.LSTM(
            input_dim,
            hidden_dim,
            num_layers,
            batch_first=True,
            dropout=0.2 if num_layers > 1 else 0.0
        )
        self.fc = nn.Linear(hidden_dim, output_dim)
        
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        device = x.device
        h0 = torch.zeros(self.num_layers, x.size(0), self.hidden_dim).to(device)
        c0 = torch.zeros(self.num_layers, x.size(0), self.hidden_dim).to(device)
        
        out, _ = self.lstm(x, (h0, c0))
        out = self.fc(out[:, -1, :])
        return out

def prepare_sequential_data(X_flat: np.ndarray, y_flat: np.ndarray, sequence_length: int = 60) -> Tuple[np.ndarray, np.ndarray]:
    """
    Groups flat feature data into sequential overlapping segments of `sequence_length`.
    """
    X_seq, y_seq = [], []
    if len(X_flat) < sequence_length:
        return np.empty((0, sequence_length, X_flat.shape[1])), np.empty((0,))
        
    for i in range(sequence_length, len(X_flat) + 1):
        X_seq.append(X_flat[i - sequence_length : i])
        y_seq.append(y_flat[i - 1])
        
    return np.array(X_seq, dtype=float), np.array(y_seq, dtype=int)

def train_lstm_model(
    X_flat: np.ndarray,
    y_flat: np.ndarray,
    epochs: int = 5,
    batch_size: int = 64,
    lr: float = 0.001,
    sequence_length: int = 60
) -> LSTMClassifier:
    """
    Prepares sequential data, instantiates, and trains the LSTM model.
    """
    X_seq, y_seq = prepare_sequential_data(X_flat, y_flat, sequence_length)
    
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    input_dim = X_seq.shape[2] if len(X_seq) > 0 else 50
    model = LSTMClassifier(input_dim=input_dim).to(device)
    
    if len(X_seq) == 0:
        print("Warning: Not enough sequential data to train LSTM. Model untrained.")
        return model

    criterion = nn.CrossEntropyLoss()
    optimizer = optim.Adam(model.parameters(), lr=lr)
    
    X_tensor = torch.tensor(X_seq, dtype=torch.float32)
    y_tensor = torch.tensor(y_seq, dtype=torch.long)
    
    # Split into train (80%) and validation (20%) chronologically
    split = int(len(X_seq) * 0.8)
    train_dataset = torch.utils.data.TensorDataset(X_tensor[:split], y_tensor[:split])
    val_dataset = torch.utils.data.TensorDataset(X_tensor[split:], y_tensor[split:])
    
    train_loader = torch.utils.data.DataLoader(train_dataset, batch_size=batch_size, shuffle=False)
    val_loader = torch.utils.data.DataLoader(val_dataset, batch_size=batch_size, shuffle=False)
    
    model.train()
    for epoch in range(epochs):
        epoch_loss = 0.0
        for batch_X, batch_y in train_loader:
            batch_X, batch_y = batch_X.to(device), batch_y.to(device)
            optimizer.zero_grad()
            outputs = model(batch_X)
            loss = criterion(outputs, batch_y)
            loss.backward()
            optimizer.step()
            epoch_loss += loss.item() * batch_X.size(0)
            
        avg_loss = epoch_loss / len(train_dataset)
        
        # Validation
        model.eval()
        val_loss = 0.0
        with torch.no_grad():
            for batch_X, batch_y in val_loader:
                batch_X, batch_y = batch_X.to(device), batch_y.to(device)
                outputs = model(batch_X)
                loss = criterion(outputs, batch_y)
                val_loss += loss.item() * batch_X.size(0)
        val_loss /= len(val_dataset)
        
        print(f"LSTM Epoch {epoch+1}/{epochs} - Train Loss: {avg_loss:.4f} - Val Loss: {val_loss:.4f}")
        model.train()
        
    torch.save(model.state_dict(), MODEL_PATH)
    print(f"Saved LSTM model weights to {MODEL_PATH}")
    return model

def predict_lstm(seq_features: List[Dict[str, float]], feature_names: List[str]) -> Dict[str, Any]:
    """
    Given a list of 60 hourly feature dicts, runs LSTM inference and returns probabilities.
    """
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    input_dim = len(feature_names)
    model = LSTMClassifier(input_dim=input_dim).to(device)
    
    if os.path.exists(MODEL_PATH):
        try:
            model.load_state_dict(torch.load(MODEL_PATH, map_location=device, weights_only=True))
            model.eval()
        except Exception as e:
            print(f"Error loading LSTM model state dict: {e}")
    else:
        # Fallback random predictions if weights don't exist
        print("Warning: LSTM model weights not found. Using fallback inference.")
        probs = [0.4, 0.3, 0.3]
        return {
            "signal": "HOLD",
            "confidence": 40.0,
            "probabilities": {"HOLD": 40.0, "BUY": 30.0, "SELL": 30.0}
        }

    seq_data = []
    for f_dict in seq_features:
        row = [f_dict.get(n, 0.0) for n in feature_names]
        seq_data.append(row)
        
    seq_tensor = torch.tensor([seq_data], dtype=torch.float32).to(device)
    
    with torch.no_grad():
        outputs = model(seq_tensor)
        probs = torch.softmax(outputs, dim=1).cpu().numpy()[0]
        
    cls = int(np.argmax(probs))
    labels = ["HOLD", "BUY", "SELL"]
    sig = labels[cls]
    conf = round(float(probs[cls]) * 100, 1)
    
    return {
        "signal": sig,
        "confidence": conf,
        "probabilities": {
            "HOLD": round(float(probs[0] * 100), 1),
            "BUY": round(float(probs[1] * 100), 1),
            "SELL": round(float(probs[2] * 100), 1)
        }
    }
