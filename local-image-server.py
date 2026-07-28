import gc
import os
import threading
import time
import traceback
import uuid
from pathlib import Path

import torch
import uvicorn
from diffusers import DiffusionPipeline
from fastapi import FastAPI, HTTPException
from PIL import Image, ImageFilter
from pydantic import BaseModel, Field


ROOT = Path(__file__).resolve().parent
MODEL_CACHE = ROOT / "AI_Models" / "imagegen" / "hub"
OUTPUT_DIR = ROOT / "generated-media" / "images"
QUALITY_MODEL_ID = "SimianLuo/LCM_Dreamshaper_v7"
LOW_MEMORY_MODEL_ID = "segmind/tiny-sd"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Presentator Local Image Brain")
pipeline = None
active_model_id = ""
pipeline_lock = threading.Lock()
pipeline_idle_timer = None
pipeline_last_used = 0.0
PIPELINE_IDLE_SECONDS = 600
generating = False
last_error = ""
generation_stage = "idle"
generation_step = 0
generation_total_steps = 8


class ImageRequest(BaseModel):
    prompt: str = Field(min_length=3, max_length=2000)
    negativePrompt: str = Field(default="", max_length=1000)
    seed: int = Field(default=0, ge=0, le=2_147_483_647)
    width: int = Field(default=768, ge=256, le=768)
    height: int = Field(default=432, ge=256, le=768)
    outputWidth: int = Field(default=3840, ge=1024, le=3840)
    outputHeight: int = Field(default=2160, ge=576, le=2160)


def available_virtual_memory():
    if os.name != "nt":
        return 16 * 1024**3
    import ctypes

    class MemoryStatus(ctypes.Structure):
        _fields_ = [
            ("length", ctypes.c_ulong),
            ("memory_load", ctypes.c_ulong),
            ("total_physical", ctypes.c_ulonglong),
            ("available_physical", ctypes.c_ulonglong),
            ("total_page_file", ctypes.c_ulonglong),
            ("available_page_file", ctypes.c_ulonglong),
            ("total_virtual", ctypes.c_ulonglong),
            ("available_virtual", ctypes.c_ulonglong),
            ("available_extended_virtual", ctypes.c_ulonglong),
        ]

    status = MemoryStatus()
    status.length = ctypes.sizeof(status)
    ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status))
    return int(status.available_page_file)


def load_pipeline():
    global pipeline, active_model_id, last_error, pipeline_last_used
    if pipeline is not None:
        return pipeline
    with pipeline_lock:
        if pipeline is not None:
            return pipeline
        try:
            torch.set_num_threads(max(1, min(12, os.cpu_count() or 8)))
            # Dreamshaper expands far beyond its 4 GB download while loading.
            # Use the installed 1 GB model when Windows has less than 7 GB of
            # commit available, preventing a worker crash/ECONNRESET.
            active_model_id = (
                QUALITY_MODEL_ID
                if available_virtual_memory() >= 10 * 1024**3
                else LOW_MEMORY_MODEL_ID
            )
            pipeline = DiffusionPipeline.from_pretrained(
                active_model_id,
                cache_dir=str(MODEL_CACHE),
                local_files_only=True,
                torch_dtype=torch.float32,
                # Load weights directly into their destination modules instead
                # of holding a second full state dict in RAM. This is critical
                # on the 16 GB Windows machine and prevents worker termination.
                low_cpu_mem_usage=True,
                safety_checker=None,
                feature_extractor=None,
                requires_safety_checker=False,
            )
            pipeline = pipeline.to("cpu")
            # "max" slices one attention head at a time and is unnecessarily
            # slow on this 16 GB machine. Auto slicing keeps memory safe while
            # allowing substantially more CPU work per operation.
            pipeline.enable_attention_slicing()
            pipeline.enable_vae_slicing()
            if hasattr(pipeline, "unet"):
                pipeline.unet.to(memory_format=torch.channels_last)
            if hasattr(pipeline, "vae"):
                pipeline.vae.to(memory_format=torch.channels_last)
            pipeline.set_progress_bar_config(disable=True)
            pipeline_last_used = time.monotonic()
            last_error = ""
            return pipeline
        except Exception as error:
            last_error = f"{type(error).__name__}: {error}"
            traceback.print_exc()
            raise


def unload_pipeline():
    global pipeline, pipeline_idle_timer
    with pipeline_lock:
        if generating:
            return False
        pipeline = None
        pipeline_idle_timer = None
    gc.collect()
    return True


def schedule_pipeline_unload():
    global pipeline_idle_timer, pipeline_last_used
    pipeline_last_used = time.monotonic()
    if pipeline_idle_timer is not None:
        pipeline_idle_timer.cancel()
    pipeline_idle_timer = threading.Timer(PIPELINE_IDLE_SECONDS, unload_pipeline)
    pipeline_idle_timer.daemon = True
    pipeline_idle_timer.start()


@app.get("/health")
def health():
    return {
        "ok": True,
        "model": active_model_id or (
            QUALITY_MODEL_ID
            if available_virtual_memory() >= 10 * 1024**3
            else LOW_MEMORY_MODEL_ID
        ),
        "memoryProfile": "quality" if active_model_id == QUALITY_MODEL_ID else "stable",
        "modelReady": pipeline is not None,
        "cacheSeconds": PIPELINE_IDLE_SECONDS,
        "generating": generating,
        "stage": generation_stage,
        "step": generation_step,
        "totalSteps": generation_total_steps,
        "percent": round((generation_step / max(1, generation_total_steps)) * 100),
        "lastError": last_error,
    }


@app.post("/api/unload")
def unload_image_model():
    if generating:
        raise HTTPException(status_code=409, detail="Image generation is active; model was not disturbed.")
    return {"ok": unload_pipeline()}


@app.post("/api/generate-image")
def generate_image(request: ImageRequest):
    global generating, last_error, pipeline, generation_stage, generation_step, generation_total_steps
    if generating:
        raise HTTPException(status_code=409, detail="Image generation is already running.")
    generating = True
    generation_stage = "loading_model"
    generation_step = 0
    generation_total_steps = 8
    started = time.perf_counter()
    try:
        pipe = load_pipeline()
        seed = request.seed or int(time.time()) % 2_147_483_647
        generator = torch.Generator(device="cpu").manual_seed(seed)
        prompt = (
            f"{request.prompt.strip()}, premium full 3D cinematic render, physically based materials, "
            "ray-traced global illumination, volumetric lighting, realistic depth and shadows, "
            "masterpiece, best quality, extremely detailed, sharp focus, coherent anatomy, "
            "realistic fine textures, professional cinematic lighting, balanced color grading, "
            "clean composition, presentation-ready, 16:9 widescreen, no text, no watermark"
        )
        generation_stage = "diffusion"

        def report_step(step, _timestep, _latents):
            global generation_step
            generation_step = min(generation_total_steps, int(step) + 1)

        generation_total_steps = 8 if active_model_id == QUALITY_MODEL_ID else 12
        inference_options = dict(
            prompt=prompt,
            negative_prompt=request.negativePrompt.strip() or None,
            num_inference_steps=generation_total_steps,
            guidance_scale=7.5,
            width=(request.width // 8) * 8,
            height=(request.height // 8) * 8,
            generator=generator,
            callback=report_step,
            callback_steps=1,
        )
        if active_model_id == QUALITY_MODEL_ID:
            inference_options["lcm_origin_steps"] = 50
        result = pipe(**inference_options)
        generation_stage = "upscaling_4k"
        file_name = f"presentator-{int(time.time())}-{uuid.uuid4().hex[:8]}.png"
        output_path = OUTPUT_DIR / file_name
        image = result.images[0]
        image = image.resize((request.outputWidth, request.outputHeight), Image.Resampling.LANCZOS)
        image = image.filter(ImageFilter.UnsharpMask(radius=1.35, percent=125, threshold=3))
        generation_stage = "saving"
        # PNG compression does not change image quality. A moderate level saves
        # 4K files much faster than Pillow's exhaustive optimize pass.
        image.save(output_path, format="PNG", compress_level=4)
        last_error = ""
        return {
            "ok": True,
            "imagePath": str(output_path),
            "fileName": file_name,
            "seed": seed,
            "width": image.width,
            "height": image.height,
            "qualityProfile": (
                "4K full 3D cinematic"
                if active_model_id == QUALITY_MODEL_ID
                else "4K stable low-memory render"
            ),
            "model": active_model_id,
            "elapsedSeconds": round(time.perf_counter() - started, 2),
        }
    except Exception as error:
        last_error = f"{type(error).__name__}: {error}"
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=last_error)
    finally:
        generating = False
        generation_stage = "idle"
        generation_step = 0
        schedule_pipeline_unload()


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8432, log_level="info")
