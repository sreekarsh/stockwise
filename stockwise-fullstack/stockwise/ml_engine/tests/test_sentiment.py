from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

import math
from unittest.mock import patch


def test_sentiment_fallback_on_import_error():
    with patch.dict("sys.modules", {"vaderSentiment": None}):
        from importlib import reload
        import sentiment
        reload(sentiment)
        analyzer = sentiment._get_analyzer()
        assert analyzer is None


def test_sentiment_score_range():
    try:
        from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
        analyzer = SentimentIntensityAnalyzer()
    except ImportError:
        return

    texts = {
        "This is great news for crypto!": 0.5,
        "Terrible crash, everything is down": -0.5,
        "The market is trading sideways today": 0.0,
    }
    for text, expected_dir in texts.items():
        score = analyzer.polarity_scores(text)["compound"]
        if expected_dir > 0:
            assert score > 0, f"Expected positive for '{text}', got {score}"
        elif expected_dir < 0:
            assert score < 0, f"Expected negative for '{text}', got {score}"
        assert -1.0 <= score <= 1.0, f"Score {score} out of range"


def test_sentiment_neutral_on_empty_text():
    from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
    analyzer = SentimentIntensityAnalyzer()
    score = analyzer.polarity_scores("")["compound"]
    assert score == 0.0
