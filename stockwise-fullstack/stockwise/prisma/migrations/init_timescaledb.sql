-- Initialize TimescaleDB extension and create hypertable for tick-by-tick candle updates
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS candle_ticks (
  time TIMESTAMPTZ NOT NULL,
  symbol TEXT NOT NULL,
  open DOUBLE PRECISION,
  high DOUBLE PRECISION,
  low DOUBLE PRECISION,
  close DOUBLE PRECISION,
  volume DOUBLE PRECISION
);

-- Convert standard table to TimescaleDB hypertable partitioned by time
SELECT create_hypertable('candle_ticks', 'time', if_not_exists => TRUE);
