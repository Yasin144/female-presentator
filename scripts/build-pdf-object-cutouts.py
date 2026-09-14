"""Prepare reviewed-profile original-pixel cutouts; never used on unknown PDFs.

Run with the existing .imagegen-venv Python. Model/dependencies are isolated in
vendor/pdf-cutouts; runtime rendering only consumes the resulting PNG assets.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import warnings

ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / "vendor" / "pdf-cutouts"
sys.path[:0] = [str(VENDOR / "python"), str(VENDOR)]
os.environ["OMP_NUM_THREADS"] = "2"
os.environ["MKL_NUM_THREADS"] = "2"
warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", message="Overwriting tiny_vit")
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy import ndimage
import torch
from mobile_sam import sam_model_registry, SamPredictor

torch.set_num_threads(2)
torch.set_num_interop_threads(1)


def read_profile():
    code = """const fs=require('fs'),vm=require('vm');
const s=fs.readFileSync(process.argv[1],'utf8'),c={};
vm.runInNewContext(s.slice(s.indexOf('const PDF_COUNTING_WORDS ='),s.indexOf('function getPdfCountingActivity('))+';result={fingerprint:PDF_COUNTING_DOCUMENT_ID,layouts:PDF_COUNTING_LAYOUTS};',c);
process.stdout.write(JSON.stringify(c.result));"""
    return json.loads(subprocess.check_output(["node", "-e", code, str(ROOT / "script.js")], text=True))


def component_at_points(mask, positive):
    labels, count = ndimage.label(mask)
    selected = set()
    for x, y in positive:
        px, py = int(round(x)), int(round(y))
        py, px = np.clip(py, 0, mask.shape[0]-1), np.clip(px, 0, mask.shape[1]-1)
        label = labels[py, px]
        if label:
            selected.add(int(label))
    if not selected:
        return np.zeros_like(mask)
    return np.isin(labels, list(selected))


def choose_mask(masks, scores, positive, negative, box):
    candidates = []
    for mask, score in zip(masks, scores):
        mask = ndimage.binary_fill_holes(component_at_points(mask, positive))
        if box is not None:
            x0, y0, x1, y1 = np.round(box).astype(int)
            allowed = np.zeros_like(mask)
            allowed[max(0,y0):min(mask.shape[0],y1+1), max(0,x0):min(mask.shape[1],x1+1)] = True
            mask &= allowed
        area = int(mask.sum())
        if not area:
            continue
        included = sum(bool(mask[int(np.clip(round(y),0,mask.shape[0]-1)), int(np.clip(round(x),0,mask.shape[1]-1))]) for x,y in negative)
        positive_hits = sum(bool(mask[int(np.clip(round(y),0,mask.shape[0]-1)), int(np.clip(round(x),0,mask.shape[1]-1))]) for x,y in positive)
        merit = float(score) - included * 2 - (len(positive)-positive_hits)
        candidates.append((merit, float(score), included, mask))
    if not candidates:
        raise RuntimeError("No candidate mask contains the verified object point.")
    _, score, included, mask = max(candidates, key=lambda item:item[0])
    if included:
        raise RuntimeError("Mask includes a different object's verified center.")
    return mask, score


def isolate_white_star(rgb, point, box):
    """Known night-sky page: retain the actual pale star, not blue SAM spill."""
    channels=rgb.astype(np.float32)
    red,green,blue=channels[:,:,0],channels[:,:,1],channels[:,:,2]
    mask=(red>=180)&(green>=180)&(blue-(red+green)/2<=25)
    x0,y0,x1,y1=np.round(box).astype(int)
    allowed=np.zeros_like(mask)
    allowed[max(0,y0):min(mask.shape[0],y1+1),max(0,x0):min(mask.shape[1],x1+1)]=True
    mask=component_at_points(mask&allowed,[point])
    if int(mask.sum())<50:
        raise RuntimeError("The reviewed star silhouette could not be isolated.")
    return ndimage.binary_fill_holes(mask)


def save_cutout(image, mask, target):
    ys, xs = np.nonzero(mask)
    x0, y0 = max(0,int(xs.min())-2), max(0,int(ys.min())-2)
    x1, y1 = min(image.width,int(xs.max())+3), min(image.height,int(ys.max())+3)
    rgba = image.convert("RGBA").crop((x0,y0,x1,y1))
    alpha = Image.fromarray(mask[y0:y1,x0:x1].astype(np.uint8)*255, "L")
    # A subpixel edge softens jagged segmentation without inventing any pixels.
    alpha = alpha.filter(ImageFilter.GaussianBlur(.35))
    rgba.putalpha(alpha)
    rgba.save(target, optimize=True)
    return rgba.size, [x0/image.width,y0/image.height,(x1-x0)/image.width,(y1-y0)/image.height]


def contact_sheet(page_dir, count, destination):
    columns, cell_w, cell_h = 5, 240, 230
    rows = (count + columns - 1) // columns
    sheet = Image.new("RGB", (columns*cell_w, rows*cell_h), "#e2e8f0")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 22)
    for index in range(count):
        x, y = index%columns*cell_w, index//columns*cell_h
        draw.rectangle((x+4,y+4,x+cell_w-4,y+cell_h-4), fill="#f8fafc")
        file = page_dir/f"{index+1}.png"
        draw.text((x+12,y+10), str(index+1), fill="#0f172a", font=font)
        if file.exists():
            cutout=Image.open(file).convert("RGBA")
            cutout.thumbnail((cell_w-32,cell_h-48), Image.Resampling.LANCZOS)
            sheet.paste(cutout,(x+(cell_w-cutout.width)//2,y+40+(cell_h-48-cutout.height)//2),cutout)
        else:
            draw.text((x+20,y+95),"MASK FAILED",fill="#b91c1c",font=font)
    sheet.save(destination)


def read_polygons(path, refinements_path, fallback=None):
    polygons=json.loads(path.read_text()) if path.exists() else json.loads(json.dumps(fallback or {}))
    refinements=json.loads(refinements_path.read_text()) if refinements_path.exists() else {}
    for page, values in refinements.items():
        target=polygons.setdefault(page,[])
        while len(target)<len(values):
            target.append(None)
        for index, value in enumerate(values):
            if value:
                target[index]=value
    return polygons


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--pages", default="26-35")
    parser.add_argument("--objects", default="", help="Rebuild only these one-based object numbers on selected pages")
    parser.add_argument("--input-dir", type=Path, default=ROOT/"tmp/pdfs/nursery-pages")
    parser.add_argument("--boxes", type=Path, default=ROOT/"tmp/pdf-object-reveal/boxes.json")
    parser.add_argument("--notes", type=Path, default=ROOT/"tmp/pdf-object-reveal/boxes-notes.json")
    parser.add_argument("--polygons", type=Path, default=ROOT/"tmp/pdf-object-reveal/polygons.json")
    parser.add_argument("--refined-polygons", type=Path, default=ROOT/"tmp/pdf-object-reveal/refined-polygons.json")
    parser.add_argument("--full-page", action="store_true", help="Use a shared low-detail full-page embedding instead of cropped object prompts")
    parser.add_argument("--output-dir", type=Path)
    args=parser.parse_args()
    profile=read_profile()
    output=args.output_dir or ROOT/"assets/pdf-counting"/profile["fingerprint"]
    output.mkdir(parents=True,exist_ok=True)
    qa_dir=ROOT/"tmp/pdf-object-reveal"
    qa_dir.mkdir(parents=True,exist_ok=True)
    prompt_record=output/"segmentation-prompts.json"
    saved_prompts=json.loads(prompt_record.read_text()) if prompt_record.exists() else {}
    boxes=json.loads(args.boxes.read_text()) if args.boxes.exists() else saved_prompts.get("boxes",{})
    notes=json.loads(args.notes.read_text()) if args.notes.exists() else saved_prompts.get("notes",{})
    polygons=read_polygons(args.polygons,args.refined_polygons,saved_prompts.get("polygons",{}))
    (output/"segmentation-prompts.json").write_text(json.dumps({"boxes":boxes,"notes":notes,"polygons":polygons},indent=2))
    page_numbers=[]
    for part in args.pages.split(","):
        if "-" in part:
            start,end=map(int,part.split("-")); page_numbers.extend(range(start,end+1))
        else: page_numbers.append(int(part))
    selected_objects={int(part) for part in args.objects.split(",") if part.strip()}
    manifest_path=output/"manifest.json"
    manifest=json.loads(manifest_path.read_text()) if manifest_path.exists() else {
        "schemaVersion":1,"fingerprint":profile["fingerprint"],"sourceBoundsFormat":"normalized xywh",
        "method":"MobileSAM masks of original visible pixels; reviewed fixed PDF only","pages":{}}
    model=sam_model_registry["vit_t"](checkpoint=str(VENDOR/"weights/mobile_sam.pt"))
    manifest["fingerprint"]=profile["fingerprint"]
    manifest.pop("documentFingerprint", None)
    manifest["method"]="Original visible pixels isolated by MobileSAM, reviewed outline polygons, or pale-star color masks; fixed PDF only"
    model.eval()
    predictor=SamPredictor(model)
    with torch.inference_mode():
        for page_number in page_numbers:
            started=time.monotonic()
            layout=profile["layouts"][str(page_number)]
            image=Image.open(args.input_dir/f"page-{page_number}.png").convert("RGB")
            rgb=np.asarray(image)
            boxes=json.loads(args.boxes.read_text()) if args.boxes.exists() else saved_prompts.get("boxes",{})
            notes=json.loads(args.notes.read_text()) if args.notes.exists() else saved_prompts.get("notes",{})
            polygons=read_polygons(args.polygons,args.refined_polygons,saved_prompts.get("polygons",{}))
            print(f"Page {page_number}: preparing detailed object masks",flush=True)
            if args.full_page:
                predictor.set_image(rgb)
            all_points=np.array(layout["points"],dtype=np.float32)*[image.width,image.height]
            page_dir=output/f"page-{page_number}"
            page_dir.mkdir(exist_ok=True)
            entries=[]
            errors=[]
            existing_page=manifest.get("pages",{}).get(str(page_number),{})
            for index,point in enumerate(all_points):
                if selected_objects and index+1 not in selected_objects:
                    entries.extend(item for item in existing_page.get("objects",[]) if item["number"]==index+1)
                    errors.extend(item for item in existing_page.get("errors",[]) if item["number"]==index+1)
                    continue
                extra=notes.get("extraPositivePoints",{}).get(str(page_number),{}).get(str(index+1),[])
                positive=np.array([point.tolist()]+(np.array(extra)*[image.width,image.height]).tolist() if extra else [point.tolist()],dtype=np.float32)
                negative=np.delete(all_points,index,axis=0)
                prompt_points=np.concatenate([positive,negative])
                labels=np.array([1]*len(positive)+[0]*len(negative))
                box_data=boxes.get(str(page_number),[])
                box=np.array(box_data[index])*[image.width,image.height,image.width,image.height] if index<len(box_data) else None
                try:
                    page_polygons=polygons.get(str(page_number),[])
                    mask_method="MobileSAM point-and-box mask"
                    if page_number==35 and layout["noun"]=="stars" and box is not None:
                        mask=isolate_white_star(rgb,point,box)
                        score=1.0
                        mask_method="Pale-star color mask within reviewed box"
                    elif index<len(page_polygons) and page_polygons[index]:
                        polygon_mask=Image.new("L",image.size,0)
                        polygon=[tuple(p) for p in np.array(page_polygons[index])*[image.width,image.height]]
                        ImageDraw.Draw(polygon_mask).polygon(polygon,fill=255)
                        if page_number==32:
                            # The gift profile is explicitly ordered back-to-front.
                            # A foreground bow/box owns its pixels, never its neighbor.
                            occlusion=Image.new("L",image.size,0)
                            polygon_draw=ImageDraw.Draw(occlusion)
                            for foreground in page_polygons[index+1:]:
                                if foreground:
                                    points=[tuple(p) for p in np.array(foreground)*[image.width,image.height]]
                                    polygon_draw.polygon(points,fill=255)
                            # Discard the 2px ambiguous edge where touching bows
                            # otherwise leave a neighbor-colored fringe.
                            radius=max(1,round(2*image.width/886))
                            occlusion=occlusion.filter(ImageFilter.MaxFilter(radius*2+1))
                            polygon_mask=Image.fromarray(np.where(np.asarray(occlusion)>0,0,np.asarray(polygon_mask)).astype(np.uint8))
                        mask=np.asarray(polygon_mask)>0
                        score=1.0
                        mask_method="Reviewed original-visible-outline polygon"
                    elif box is not None and not args.full_page:
                        padding=np.maximum((box[2:]-box[:2])*.3,24)
                        origin=np.maximum(0,np.floor(box[:2]-padding)).astype(int)
                        limit=np.minimum([image.width,image.height],np.ceil(box[2:]+padding)).astype(int)
                        predictor.set_image(rgb[origin[1]:limit[1],origin[0]:limit[0]])
                        crop_positive=positive-origin
                        local_negative=negative[(negative[:,0]>=origin[0])&(negative[:,0]<limit[0])&(negative[:,1]>=origin[1])&(negative[:,1]<limit[1])]-origin
                        local_points=np.concatenate([crop_positive,local_negative])
                        local_labels=np.array([1]*len(crop_positive)+[0]*len(local_negative))
                        crop_box=box-np.tile(origin,2)
                        masks,scores,_=predictor.predict(point_coords=local_points,point_labels=local_labels,box=crop_box,multimask_output=True)
                        local_mask,score=choose_mask(masks,scores,crop_positive,local_negative,crop_box)
                        mask=np.zeros((image.height,image.width),dtype=bool)
                        mask[origin[1]:limit[1],origin[0]:limit[0]]=local_mask
                    else:
                        masks,scores,_=predictor.predict(point_coords=prompt_points,point_labels=labels,box=box,multimask_output=True)
                        mask,score=choose_mask(masks,scores,positive,negative,box)
                    size,bounds=save_cutout(image,mask,page_dir/f"{index+1}.png")
                    entry={"number":index+1,"src":f"page-{page_number}/{index+1}.png","width":size[0],"height":size[1],
                           "sourceBounds":bounds,"maskScore":round(score,5),"pixelArea":int(mask.sum()),
                           "maskMethod":mask_method,"sha256":hashlib.sha256((page_dir/f"{index+1}.png").read_bytes()).hexdigest()}
                    entries.append(entry)
                    print(f"  {index+1}/{len(all_points)} score={score:.3f} pixels={entry['pixelArea']}",flush=True)
                except Exception as error:
                    errors.append({"number":index+1,"error":str(error)})
                    stale_target=page_dir/f"{index+1}.png"
                    if stale_target.exists():
                        stale_target.unlink()
                    print(f"  {index+1} FAILED: {error}",flush=True)
            if manifest_path.exists():
                latest=json.loads(manifest_path.read_text())
                manifest["pages"].update(latest.get("pages",{}))
            entries.sort(key=lambda item:item["number"])
            manifest["pages"][str(page_number)]={"count":len(all_points),"noun":layout["noun"],"verified":False,"objects":entries,"errors":errors}
            manifest_path.write_text(json.dumps(manifest,indent=2))
            contact_sheet(page_dir,len(all_points),qa_dir/f"cutouts-page-{page_number}.png")
            print(f"Page {page_number} complete in {time.monotonic()-started:.1f}s; {len(errors)} failures",flush=True)
            predictor.reset_image()
    boxes=json.loads(args.boxes.read_text()) if args.boxes.exists() else saved_prompts.get("boxes",{})
    notes=json.loads(args.notes.read_text()) if args.notes.exists() else saved_prompts.get("notes",{})
    polygons=read_polygons(args.polygons,args.refined_polygons,saved_prompts.get("polygons",{}))
    (output/"segmentation-prompts.json").write_text(json.dumps({"boxes":boxes,"notes":notes,"polygons":polygons},indent=2))


if __name__=="__main__":
    main()
