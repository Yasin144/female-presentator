"""Bounded CPU LaMa reconstruction for caption holes.

``ensure_model(path, progress=None)`` verifies or atomically downloads the pinned
TorchScript weights. ``CaptionAIRepair(...).repair(frame, output_mask,
exclusion_mask=None)`` returns a new full-size uint8 BGR frame and never mutates
its inputs. Only nonzero ``output_mask`` pixels can change. ``exclusion_mask``
is additional content hidden from the model, such as other captions or logos;
it does not override explicitly requested output pixels. Clear protected pixels
from ``output_mask`` at the caller before requesting repair.

The model runs on a cropped, bounded image on CPU. There is no temporal reuse,
implicit Quick fallback, or model download at import time.
"""

import hashlib
import importlib
import os
from pathlib import Path
import tempfile
from threading import Lock
import urllib.request

import cv2
import numpy as np


MODEL_URL = "https://github.com/Sanster/models/releases/download/add_big_lama/big-lama.pt"
MODEL_MD5 = "e3aa4aaa15225a33ec84f9f4bc47e500"
MAX_MODEL_BYTES = 300 * 1024 * 1024
DOWNLOAD_BLOCK_BYTES = 1024 * 1024
MAX_INPUT_SIDE = 768


class CaptionAIRepairError(RuntimeError):
    """AI reconstruction could not complete; the caller must report the error."""


def _progress(callback, percent, message):
    if callback is not None:
        callback(int(percent), message)


def _model_digest(path):
    digest = hashlib.md5()
    with open(path, "rb") as model_file:
        for block in iter(lambda: model_file.read(DOWNLOAD_BLOCK_BYTES), b""):
            digest.update(block)
    return digest.hexdigest()


def ensure_model(model_path, progress=None):
    """Return a verified model path, retaining any old file until replacement.

    The fixed upstream URL and checksum match IOPaint's public LaMa weights.
    Downloads are limited to 300 MiB, written beside the destination, verified,
    then atomically replaced. A failed transfer never publishes partial weights
    and only its own temporary file is removed.
    """
    target = Path(os.path.abspath(os.path.expanduser(os.fspath(model_path))))
    if target.is_symlink() or (target.exists() and not target.is_file()):
        raise CaptionAIRepairError("Choose a regular file path for the caption AI model, not a directory or link.")
    temporary_path = None
    try:
        _progress(progress, 0, "Checking caption AI model")
        if target.exists() and target.stat().st_size <= MAX_MODEL_BYTES:
            if _model_digest(target) == MODEL_MD5:
                _progress(progress, 100, "Caption AI model verified")
                return str(target)
        replacing_invalid = target.exists()
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary_file = tempfile.NamedTemporaryFile(
            prefix=f".{target.name}.", suffix=".download", dir=target.parent, delete=False)
        temporary_path = Path(temporary_file.name)
        received = 0
        digest = hashlib.md5()
        request = urllib.request.Request(MODEL_URL, headers={"User-Agent": "CaptionEraser/1.0"})
        _progress(progress, 1, "Replacing corrupt caption AI model" if replacing_invalid else "Downloading caption AI model")
        with temporary_file, urllib.request.urlopen(request, timeout=60) as response:
            length_header = response.headers.get("Content-Length")
            try:
                expected_length = int(length_header) if length_header is not None else None
            except (TypeError, ValueError):
                raise CaptionAIRepairError("The caption AI model server returned an invalid download size. Retry setup.")
            if expected_length is not None and (expected_length <= 0 or expected_length > MAX_MODEL_BYTES):
                raise CaptionAIRepairError("The caption AI model download exceeds the 300 MiB limit or is empty. Retry setup.")
            last_percent = 1
            while True:
                block = response.read(DOWNLOAD_BLOCK_BYTES)
                if not block:
                    break
                received += len(block)
                if received > MAX_MODEL_BYTES:
                    raise CaptionAIRepairError("The caption AI model download exceeds the 300 MiB limit. Retry setup.")
                temporary_file.write(block)
                digest.update(block)
                denominator = expected_length or MAX_MODEL_BYTES
                percent = min(94, 1 + int(93 * received / denominator))
                if percent > last_percent:
                    _progress(progress, percent, "Downloading caption AI model")
                    last_percent = percent
            temporary_file.flush()
            os.fsync(temporary_file.fileno())
        if expected_length is not None and received != expected_length:
            raise CaptionAIRepairError("The caption AI model download was interrupted. Check the connection and retry setup.")
        _progress(progress, 95, "Verifying caption AI model download")
        if not received or digest.hexdigest() != MODEL_MD5:
            raise CaptionAIRepairError("The caption AI model checksum does not match. Check the connection and retry setup.")
        os.replace(temporary_path, target)
        temporary_path = None
        _progress(progress, 100, "Caption AI model ready")
        return str(target)
    except CaptionAIRepairError:
        raise
    except Exception as error:
        raise CaptionAIRepairError(
            f"Could not prepare the caption AI model ({type(error).__name__}). "
            "Check the internet connection, free disk space, and model-folder permissions; then retry setup.") from error
    finally:
        if temporary_path is not None:
            try:
                temporary_path.unlink(missing_ok=True)
            except OSError:
                pass


def _binary_mask(mask, shape, name):
    array = np.asarray(mask)
    if array.shape != shape or array.dtype.kind not in "buif":
        raise ValueError(f"{name} must be a numeric mask matching the frame height and width")
    if array.dtype.kind == "f" and not np.isfinite(array).all():
        raise ValueError(f"{name} contains invalid mask values")
    return array > 0


class CaptionAIRepair:
    """Lazy CPU LaMa repair; input and output frames use OpenCV's BGR order."""

    def __init__(self, model_path, progress=None, max_side=MAX_INPUT_SIDE):
        if isinstance(max_side, bool) or not isinstance(max_side, int) or max_side < 32:
            raise ValueError("max_side must be an integer of at least 32 pixels")
        self.model_path = os.fspath(model_path)
        self.progress = progress
        self.max_side = min(MAX_INPUT_SIDE, max_side) // 8 * 8
        self._torch = None
        self._model = None
        self._load_lock = Lock()

    def _load_model(self):
        if self._model is not None:
            return
        with self._load_lock:
            if self._model is not None:
                return
            model_path = ensure_model(self.model_path, self.progress)
            try:
                torch = importlib.import_module("torch")
            except Exception as error:
                raise CaptionAIRepairError(
                    "The caption AI runtime cannot load PyTorch. Run Caption Eraser AI setup and retry.") from error
            try:
                torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
                _progress(self.progress, 100, "Loading caption AI model on CPU")
                model = torch.jit.load(model_path, map_location="cpu").eval()
            except Exception as error:
                raise CaptionAIRepairError(
                    f"The verified caption AI model could not load on CPU ({type(error).__name__}). "
                    "Check available memory and the Caption Eraser AI runtime, then retry.") from error
            self._torch, self._model = torch, model
            _progress(self.progress, 100, "Caption AI repair ready on CPU")

    def _infer(self, rgb_image, mask):
        self._load_model()
        image_data = np.ascontiguousarray(rgb_image.transpose(2, 0, 1), dtype=np.float32) / 255.0
        mask_data = np.ascontiguousarray(mask[np.newaxis], dtype=np.float32)
        try:
            image_tensor = self._torch.from_numpy(image_data).unsqueeze(0)
            mask_tensor = self._torch.from_numpy(mask_data).unsqueeze(0)
            with self._torch.inference_mode():
                prediction = self._model(image_tensor, mask_tensor)
            rgb_result = prediction[0].permute(1, 2, 0).detach().cpu().numpy()
            if rgb_result.shape != rgb_image.shape or not np.isfinite(rgb_result).all():
                raise ValueError("Invalid model output shape or values")
            rgb_result = np.clip(rgb_result * 255.0, 0, 255).astype(np.uint8)
            return cv2.cvtColor(rgb_result, cv2.COLOR_RGB2BGR)
        except Exception as error:
            raise CaptionAIRepairError(
                f"Caption AI reconstruction failed on CPU ({type(error).__name__}). "
                "Check available memory and retry with a smaller caption region.") from error

    def repair(self, frame, output_mask, exclusion_mask=None):
        """Return repaired BGR pixels only where ``output_mask`` is nonzero.

        Other proved captions and protected logos should be in ``exclusion_mask``
        so their colors cannot become donor texture. Exclusions outside the output
        mask are never written back. A failed model leaves the input untouched and
        raises ``CaptionAIRepairError``; the caller decides how to present failure.
        """
        if not isinstance(frame, np.ndarray) or frame.ndim != 3 or frame.shape[2] != 3 or frame.dtype != np.uint8:
            raise ValueError("frame must be a uint8 BGR image with three channels")
        height, width = frame.shape[:2]
        if not height or not width:
            raise ValueError("frame must not be empty")
        holes = _binary_mask(output_mask, (height, width), "output_mask")
        exclusions = np.zeros_like(holes) if exclusion_mask is None else _binary_mask(
            exclusion_mask, (height, width), "exclusion_mask")
        repaired = frame.copy()
        ys, xs = np.nonzero(holes)
        if not len(xs):
            return repaired
        left, right, top, bottom = int(xs.min()), int(xs.max()) + 1, int(ys.min()), int(ys.max()) + 1
        margin = max(32, min(128, int(max(right - left, bottom - top) * 0.25)))
        left, right = max(0, left - margin), min(width, right + margin)
        top, bottom = max(0, top - margin), min(height, bottom + margin)
        crop = frame[top:bottom, left:right]
        model_mask = (holes[top:bottom, left:right] | exclusions[top:bottom, left:right]).astype(np.float32)
        if model_mask.all():
            raise CaptionAIRepairError("Caption AI repair needs visible background around the selected caption region.")
        crop_height, crop_width = crop.shape[:2]
        scale = min(1.0, self.max_side / max(crop_height, crop_width))
        input_width, input_height = max(1, round(crop_width * scale)), max(1, round(crop_height * scale))
        if (input_width, input_height) != (crop_width, crop_height):
            crop = cv2.resize(crop, (input_width, input_height), interpolation=cv2.INTER_AREA)
            # Area coverage retains thin letters and exclusion pixels during
            # downsampling. Nearest sampling can miss them and leak text colors.
            model_mask = (cv2.resize(model_mask, (input_width, input_height), interpolation=cv2.INTER_AREA) > 0).astype(np.float32)
        rgb_image = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
        padded_height = max(32, (input_height + 7) // 8 * 8)
        padded_width = max(32, (input_width + 7) // 8 * 8)
        padding = ((0, padded_height - input_height), (0, padded_width - input_width))
        rgb_image = np.pad(rgb_image, padding + ((0, 0),), mode="symmetric")
        model_mask = np.pad(model_mask, padding, mode="symmetric")
        filled = self._infer(rgb_image, model_mask)[:input_height, :input_width]
        if filled.shape[:2] != (crop_height, crop_width):
            filled = cv2.resize(filled, (crop_width, crop_height), interpolation=cv2.INTER_CUBIC)
        writable = holes[top:bottom, left:right]
        repaired_crop = repaired[top:bottom, left:right]
        repaired_crop[writable] = filled[writable]
        return repaired
