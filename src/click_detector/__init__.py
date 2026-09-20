"""Detection of short digital discontinuities in music recordings."""

from .detector import Detection, Sensitivity, detect_array

__all__ = ["Detection", "Sensitivity", "detect_array"]
__version__ = "0.1.0"
