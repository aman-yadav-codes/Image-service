#!/usr/bin/env python3
"""
High-Performance Target-Size Image Compressor (WebP)
Supports both PyVips (libvips) and Pillow engines.
Automatically searches for the highest visual quality (Q) that produces <= target size.
"""

import os
import sys
import io
import time
import math
import argparse
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Tuple, Optional, Dict, Any, List

# Check PyVips availability
PYVIPS_AVAILABLE = False
try:
    import pyvips
    # Test if libvips native library is loaded
    _ = pyvips.version(0)
    PYVIPS_AVAILABLE = True
except Exception:
    PYVIPS_AVAILABLE = False

# PIL is standard fallback
from PIL import Image, ImageOps

# Try importing rich for nice console reporting
try:
    from rich.console import Console
    from rich.table import Table
    from rich.progress import Progress, SpinnerColumn, BarColumn, TextColumn, TimeRemainingColumn
    console = Console()
    HAS_RICH = True
except ImportError:
    console = None
    HAS_RICH = False


def format_size(bytes_val: int) -> str:
    """Format bytes into human-readable string."""
    if bytes_val < 1024:
        return f"{bytes_val} B"
    elif bytes_val < 1024 * 1024:
        return f"{bytes_val / 1024:.1f} KB"
    else:
        return f"{bytes_val / (1024 * 1024):.2f} MB"


class ImageCompressor:
    def __init__(
        self,
        engine: str = "auto",
        effort: int = 6,
        smart_subsample: bool = True,
        strip_metadata: bool = True,
        min_q: int = 15,
        max_q: int = 95,
        allow_resize: bool = True,
        min_dimension: int = 400,
        verbose: bool = False
    ):
        """
        :param engine: 'auto', 'pyvips', or 'pillow'
        :param effort: WebP CPU effort (0-6, 6 is maximum compression)
        :param smart_subsample: Use smart subsampling for WebP
        :param strip_metadata: Strip EXIF, ICC, and metadata to maximize space savings
        :param min_q: Minimum quality allowed during search (1-100)
        :param max_q: Maximum quality allowed during search (1-100)
        :param allow_resize: If True, downscales image resolution if target size cannot
                             be met at min_q with acceptable visual quality
        :param min_dimension: Minimum allowed dimension (width or height) if auto-resized
        :param verbose: Print detailed search iterations
        """
        if engine == "pyvips" and not PYVIPS_AVAILABLE:
            print("[Warning] pyvips requested but libvips native library is not available. Falling back to Pillow.")
            self.engine = "pillow"
        elif engine == "auto":
            self.engine = "pyvips" if PYVIPS_AVAILABLE else "pillow"
        else:
            self.engine = engine

        self.effort = max(0, min(6, effort))
        self.smart_subsample = smart_subsample
        self.strip_metadata = strip_metadata
        self.min_q = min_q
        self.max_q = max_q
        self.allow_resize = allow_resize
        self.min_dimension = min_dimension
        self.verbose = verbose

    # -------------------------------------------------------------------------
    # Pillow Encoding Helpers
    # -------------------------------------------------------------------------
    def _encode_pillow(self, pil_img: Image.Image, q: int) -> bytes:
        """Encode a PIL Image to WebP bytes."""
        buf = io.BytesIO()
        save_kwargs = {
            "format": "WEBP",
            "quality": int(q),
            "method": self.effort,
        }
        # WebP options supported by Pillow
        try:
            pil_img.save(buf, **save_kwargs)
        except OSError:
            # If CMYK or strange mode, convert to RGB
            if pil_img.mode in ("CMYK", "P"):
                pil_img = pil_img.convert("RGB")
            pil_img.save(buf, **save_kwargs)
            
        return buf.getvalue()

    # -------------------------------------------------------------------------
    # PyVips Encoding Helpers
    # -------------------------------------------------------------------------
    def _encode_pyvips(self, vips_img, q: int, target_bytes: Optional[int] = None) -> bytes:
        """Encode a PyVips Image to WebP bytes."""
        options = {
            "Q": int(q),
            "effort": self.effort,
            "smart_subsample": self.smart_subsample,
            "strip": self.strip_metadata,
        }
        if target_bytes is not None:
            options.update(target_size=target_bytes, passes=2)
        return vips_img.webpsave_buffer(**options)

    # -------------------------------------------------------------------------
    # Binary Search for Quality Level
    # -------------------------------------------------------------------------
    def _search_quality(
        self,
        img_obj,
        target_bytes: int,
        min_q: int,
        max_q: int,
        encode_fn
    ) -> Tuple[Optional[int], Optional[bytes], List[Tuple[int, int]]]:
        """
        Binary search to find the highest Q where size <= target_bytes.
        Returns (best_q, best_bytes, iteration_log).
        """
        low = min_q
        high = max_q
        best_q = None
        best_data = None
        history: List[Tuple[int, int]] = []

        # We first check max_q: if max_q already satisfies target, use max_q!
        data_max = encode_fn(img_obj, high)
        sz_max = len(data_max)
        history.append((high, sz_max))
        if sz_max <= target_bytes:
            return high, data_max, history

        # Binary search loop
        while low <= high:
            mid = (low + high) // 2
            data = encode_fn(img_obj, mid)
            sz = len(data)
            history.append((mid, sz))

            if self.verbose:
                print(f"    [Search] Q={mid:2d} -> {format_size(sz)}")

            if sz <= target_bytes:
                # Meets constraint: save as best candidate, then try higher quality
                best_q = mid
                best_data = data
                low = mid + 1
            else:
                # Too large: try lower quality
                high = mid - 1

        # If best_q is None, lowest tested Q was still too big
        if best_q is None:
            # The smallest file produced was at min_q
            data_min = encode_fn(img_obj, min_q)
            history.append((min_q, len(data_min)))
            best_q = min_q
            best_data = data_min

        return best_q, best_data, history

    # -------------------------------------------------------------------------
    # Core Compression Method
    # -------------------------------------------------------------------------
    def compress(
        self,
        input_path: str,
        output_path: Optional[str] = None,
        target_kb: float = 70.0,
        fixed_quality: Optional[int] = None,
        max_width: Optional[int] = None,
        max_pixels: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Compress an image file to WebP targeting target_kb.
        :param input_path: Path to source image
        :param output_path: Path to write result (defaults to [name].webp)
        :param target_kb: Desired maximum target size in KB (e.g. 70.0)
        :param fixed_quality: If provided, skips search and uses this quality
        :return: Result summary dictionary
        """
        input_p = Path(input_path)
        if not input_p.exists():
            raise FileNotFoundError(f"Input file not found: {input_path}")

        if output_path is None:
            output_p = input_p.with_suffix(".webp")
        else:
            output_p = Path(output_path)
            output_p.parent.mkdir(parents=True, exist_ok=True)

        orig_size = input_p.stat().st_size
        target_bytes = int(target_kb * 1024)
        t_start = time.time()

        history: List[Tuple[int, int]] = []
        best_data: Optional[bytes] = None
        chosen_q = fixed_quality
        scale_factor = 1.0
        orig_dims = (0, 0)
        final_dims = (0, 0)

        # ---------------------------------------------------------------------
        # Execution with PyVips
        # ---------------------------------------------------------------------
        if self.engine == "pyvips" and PYVIPS_AVAILABLE:
            access_mode = "sequential" if fixed_quality is not None else "random"
            vips_img = pyvips.Image.new_from_file(str(input_p), access=access_mode)
            orig_dims = (vips_img.width, vips_img.height)
            if max_pixels is not None and orig_dims[0] * orig_dims[1] > max_pixels:
                raise ValueError(f"Image has {orig_dims[0] * orig_dims[1]} pixels, above max_pixels={max_pixels}")
            if max_width is not None and max_width > 0 and vips_img.width > max_width:
                vips_img = vips_img.resize(max_width / vips_img.width)
            final_dims = orig_dims
            curr_img = vips_img
            final_dims = (curr_img.width, curr_img.height)

            if fixed_quality is not None:
                best_data = self._encode_pyvips(curr_img, fixed_quality)
                chosen_q = fixed_quality
            elif not self.allow_resize:
                # Native target sizing is fast but is only a hint in some libwebp
                # builds. Validate it and fall back to an exact quality search.
                best_data = self._encode_pyvips(curr_img, self.max_q, target_bytes)
                chosen_q = self.max_q
                history.append((self.max_q, len(best_data)))
                if len(best_data) > target_bytes:
                    q, data, hist = self._search_quality(
                        curr_img, target_bytes, self.min_q, self.max_q, self._encode_pyvips
                    )
                    history.extend(hist)
                    best_data = data
                    chosen_q = q
            else:
                # 1. Search quality on original dimensions
                q, data, hist = self._search_quality(
                    curr_img, target_bytes, self.min_q, self.max_q, self._encode_pyvips
                )
                history.extend(hist)
                best_data = data
                chosen_q = q

                # 2. If at min_q the image is still larger than target and resizing is allowed:
                if len(best_data) > target_bytes and self.allow_resize:
                    base_dims = final_dims
                    cur_w, cur_h = base_dims
                    while len(best_data) > target_bytes and (cur_w > self.min_dimension and cur_h > self.min_dimension):
                        # Calculate needed scale reduction
                        ratio = math.sqrt(target_bytes / len(best_data))
                        # Scale conservatively (step down by 85-90% of ratio)
                        step_scale = max(0.4, min(0.9, ratio * 0.95))
                        scale_factor *= step_scale
                        cur_w = max(int(base_dims[0] * scale_factor), self.min_dimension)
                        cur_h = max(int(base_dims[1] * scale_factor), self.min_dimension)
                        final_dims = (cur_w, cur_h)

                        # PyVips resize
                        curr_img = vips_img.resize(scale_factor)

                        # Re-search quality on resized image
                        q, data, hist = self._search_quality(
                            curr_img, target_bytes, self.min_q, self.max_q, self._encode_pyvips
                        )
                        history.extend(hist)
                        best_data = data
                        chosen_q = q

        # ---------------------------------------------------------------------
        # Execution with Pillow (PIL)
        # ---------------------------------------------------------------------
        else:
            with Image.open(input_p) as pil_img:
                # Handle EXIF orientation
                pil_img = ImageOps.exif_transpose(pil_img)

                # Convert to RGB / RGBA to avoid unsupported WebP modes
                if pil_img.mode in ("RGBA", "LA") or ("transparency" in pil_img.info):
                    pil_img = pil_img.convert("RGBA")
                elif pil_img.mode not in ("RGB", "L"):
                    pil_img = pil_img.convert("RGB")

                orig_dims = pil_img.size
                if max_pixels is not None and orig_dims[0] * orig_dims[1] > max_pixels:
                    raise ValueError(f"Image has {orig_dims[0] * orig_dims[1]} pixels, above max_pixels={max_pixels}")
                if max_width is not None and max_width > 0 and pil_img.width > max_width:
                    new_height = max(1, int(pil_img.height * (max_width / pil_img.width)))
                    pil_img = pil_img.resize((max_width, new_height), Image.Resampling.LANCZOS)
                final_dims = orig_dims
                curr_img = pil_img
                final_dims = curr_img.size

                if fixed_quality is not None:
                    best_data = self._encode_pillow(curr_img, fixed_quality)
                    chosen_q = fixed_quality
                else:
                    # 1. Search quality on original dimensions
                    q, data, hist = self._search_quality(
                        curr_img, target_bytes, self.min_q, self.max_q, self._encode_pillow
                    )
                    history.extend(hist)
                    best_data = data
                    chosen_q = q

                    # 2. If at min_q it is still over target and resizing is allowed:
                    if len(best_data) > target_bytes and self.allow_resize:
                        base_dims = final_dims
                        cur_w, cur_h = base_dims
                        while len(best_data) > target_bytes and (cur_w > self.min_dimension and cur_h > self.min_dimension):
                            ratio = math.sqrt(target_bytes / len(best_data))
                            step_scale = max(0.35, min(0.90, ratio * 0.95))
                            scale_factor *= step_scale
                            cur_w = max(int(base_dims[0] * scale_factor), self.min_dimension)
                            cur_h = max(int(base_dims[1] * scale_factor), self.min_dimension)
                            final_dims = (cur_w, cur_h)

                            curr_img = pil_img.resize((cur_w, cur_h), Image.Resampling.LANCZOS)
                            q, data, hist = self._search_quality(
                                curr_img, target_bytes, self.min_q, self.max_q, self._encode_pillow
                            )
                            history.extend(hist)
                            best_data = data
                            chosen_q = q

        # Write final bytes to disk
        if len(best_data) > target_bytes:
            raise ValueError(
                f"Cannot meet {target_bytes}-byte target within configured quality and dimension limits; "
                f"smallest output is {len(best_data)} bytes"
            )

        output_p.write_bytes(best_data)
        elapsed = time.time() - t_start
        final_size = len(best_data)
        savings_pct = (1.0 - (final_size / orig_size)) * 100.0 if orig_size > 0 else 0.0

        return {
            "input": str(input_p),
            "output": str(output_p),
            "orig_size": orig_size,
            "final_size": final_size,
            "target_size": target_bytes,
            "savings_pct": savings_pct,
            "quality": chosen_q,
            "orig_dims": orig_dims,
            "final_dims": final_dims,
            "scale_factor": scale_factor,
            "engine": self.engine,
            "elapsed_seconds": elapsed,
            "iterations": len(history),
            "history": history
        }


def batch_compress(
    file_list: List[Path],
    output_dir: Optional[Path],
    compressor: ImageCompressor,
    target_kb: float = 70.0,
    fixed_quality: Optional[int] = None,
    workers: int = 4
) -> List[Dict[str, Any]]:
    """Compress multiple images in parallel."""
    results = []

    def _worker(file_path: Path):
        try:
            if output_dir:
                out_path = output_dir / f"{file_path.stem}.webp"
            else:
                out_path = file_path.with_suffix(".webp")
            return compressor.compress(
                str(file_path),
                str(out_path),
                target_kb=target_kb,
                fixed_quality=fixed_quality
            )
        except Exception as e:
            return {
                "input": str(file_path),
                "error": str(e)
            }

    if HAS_RICH:
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
            TimeRemainingColumn(),
            console=console
        ) as progress:
            task = progress.add_task(f"Compressing {len(file_list)} images...", total=len(file_list))
            with ThreadPoolExecutor(max_workers=workers) as executor:
                futures = {executor.submit(_worker, f): f for f in file_list}
                for future in as_completed(futures):
                    res = future.result()
                    results.append(res)
                    progress.advance(task)
    else:
        print(f"Compressing {len(file_list)} images using {workers} workers...")
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {executor.submit(_worker, f): f for f in file_list}
            for i, future in enumerate(as_completed(futures), 1):
                res = future.result()
                results.append(res)
                if "error" in res:
                    print(f"[{i}/{len(file_list)}] Failed {res['input']}: {res['error']}")
                else:
                    print(f"[{i}/{len(file_list)}] Compressed {Path(res['input']).name} -> Q={res['quality']}, {format_size(res['final_size'])}")

    return results


def print_single_result(res: Dict[str, Any]):
    """Print a clean breakdown for a single image compression."""
    if HAS_RICH:
        table = Table(title="[bold green]Compression Summary[/bold green]", show_header=True)
        table.add_column("Property", style="cyan", no_wrap=True)
        table.add_column("Value", style="bold white")

        table.add_row("Input File", res["input"])
        table.add_row("Output File", res["output"])
        table.add_row("Engine Used", res["engine"].upper())
        table.add_row("Original Dimensions", f"{res['orig_dims'][0]} x {res['orig_dims'][1]}")
        table.add_row("Final Dimensions", f"{res['final_dims'][0]} x {res['final_dims'][1]}" + (f" ({res['scale_factor']*100:.1f}%)" if res['scale_factor'] < 1.0 else " (100%)"))
        table.add_row("Original Size", format_size(res["orig_size"]))
        table.add_row("Target Size", format_size(res["target_size"]))
        table.add_row("Compressed Size", f"[green]{format_size(res['final_size'])}[/green]")
        table.add_row("Space Saved", f"[bold yellow]{res['savings_pct']:.1f}%[/bold yellow]")
        table.add_row("Optimal Quality (Q)", f"[bold magenta]{res['quality']}[/bold magenta]")
        table.add_row("Search Steps", f"{res['iterations']} trials")
        table.add_row("Processing Time", f"{res['elapsed_seconds']:.2f}s")
        console.print(table)
    else:
        print("\n" + "=" * 50)
        print("          COMPRESSION SUMMARY")
        print("=" * 50)
        print(f"  Input File:          {res['input']}")
        print(f"  Output File:         {res['output']}")
        print(f"  Engine:              {res['engine'].upper()}")
        print(f"  Dimensions:          {res['orig_dims'][0]}x{res['orig_dims'][1]} -> {res['final_dims'][0]}x{res['final_dims'][1]}")
        print(f"  Original Size:       {format_size(res['orig_size'])}")
        print(f"  Target Size:         {format_size(res['target_size'])}")
        print(f"  Compressed Size:     {format_size(res['final_size'])}")
        print(f"  Space Saved:         {res['savings_pct']:.1f}%")
        print(f"  Optimal Quality (Q): {res['quality']}")
        print(f"  Processing Time:     {res['elapsed_seconds']:.2f}s")
        print("=" * 50 + "\n")


def print_batch_summary(results: List[Dict[str, Any]]):
    """Print table and statistics for batch operations."""
    valid_res = [r for r in results if "error" not in r]
    errors = [r for r in results if "error" in r]

    total_orig = sum(r["orig_size"] for r in valid_res)
    total_final = sum(r["final_size"] for r in valid_res)
    overall_saving = (1 - total_final / total_orig) * 100.0 if total_orig > 0 else 0

    if HAS_RICH:
        table = Table(title=f"Batch Compression: {len(valid_res)} Images Processed", show_header=True)
        table.add_column("File", style="cyan")
        table.add_column("Orig Size", justify="right")
        table.add_column("Final Size", justify="right", style="green")
        table.add_column("Saved", justify="right", style="yellow")
        table.add_column("Q", justify="center", style="magenta")
        table.add_column("Dims", justify="center")
        table.add_column("Time", justify="right")

        for r in valid_res[:25]:  # Display first 25
            fname = Path(r["input"]).name
            table.add_row(
                fname[:22] + "..." if len(fname) > 25 else fname,
                format_size(r["orig_size"]),
                format_size(r["final_size"]),
                f"{r['savings_pct']:.1f}%",
                str(r["quality"]),
                f"{r['final_dims'][0]}x{r['final_dims'][1]}",
                f"{r['elapsed_seconds']:.2f}s"
            )

        if len(valid_res) > 25:
            table.add_row(f"... and {len(valid_res) - 25} more", "", "", "", "", "", "")

        console.print(table)
        console.print(f"\n[bold green]Total Original:[/] {format_size(total_orig)}  |  "
                      f"[bold green]Total Compressed:[/] {format_size(total_final)}  |  "
                      f"[bold yellow]Total Saved:[/] {overall_saving:.1f}%\n")
    else:
        print("\n" + "=" * 60)
        print(f"BATCH FINISHED: {len(valid_res)} processed, {len(errors)} failed.")
        print(f"Original Total:   {format_size(total_orig)}")
        print(f"Compressed Total: {format_size(total_final)}")
        print(f"Saved:            {overall_saving:.1f}%")
        print("=" * 60 + "\n")


def parse_size_to_kb(size_str: str) -> float:
    """Parse string like '70', '70kb', '0.5mb' into KB float."""
    s = size_str.strip().lower()
    if s.endswith("kb") or s.endswith("k"):
        num = s.rstrip("kb")
        return float(num)
    elif s.endswith("mb") or s.endswith("m"):
        num = s.rstrip("mb")
        return float(num) * 1024.0
    elif s.endswith("b"):
        num = s.rstrip("b")
        return float(num) / 1024.0
    else:
        return float(s)


def main():
    parser = argparse.ArgumentParser(
        description="High-Quality WebP Target-Size Image Compressor",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter
    )
    parser.add_argument("input", help="Input image file or folder path")
    parser.add_argument("-o", "--output", help="Output file or destination folder", default=None)
    parser.add_argument(
        "-t", "--target",
        dest="target",
        help="Target file size (e.g. 70, 70KB, 100KB, 0.5MB)",
        default="70"
    )
    parser.add_argument(
        "-q", "--quality",
        type=int,
        help="Fixed WebP quality (1-100). If omitted, optimal quality is auto-selected.",
        default=None
    )
    parser.add_argument(
        "--no-resize",
        action="store_true",
        help="Disable auto-downscaling if image resolution is too high to reach target size."
    )
    parser.add_argument(
        "--effort",
        type=int,
        default=6,
        help="WebP CPU effort level (0=fastest, 6=best compression/slowest)."
    )
    parser.add_argument(
        "--engine",
        choices=["auto", "pyvips", "pillow"],
        default="auto",
        help="Engine to use: 'pyvips' (fastest libvips) or 'pillow' (pure python/PIL)."
    )
    parser.add_argument(
        "--max-width",
        type=int,
        default=None,
        help="Downscale images wider than this before target-size quality search."
    )
    parser.add_argument(
        "--max-pixels",
        type=int,
        default=None,
        help="Reject source images above this pixel count."
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=4,
        help="Number of parallel worker threads for batch jobs."
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Show step-by-step quality search logs."
    )

    args = parser.parse_args()

    target_kb = parse_size_to_kb(args.target)
    compressor = ImageCompressor(
        engine=args.engine,
        effort=args.effort,
        allow_resize=not args.no_resize,
        verbose=args.verbose
    )

    in_path = Path(args.input)

    # Single File
    if in_path.is_file():
        if args.verbose:
            print(f"Target size: {target_kb:.1f} KB. Finding highest quality...")
        res = compressor.compress(
            str(in_path),
            args.output,
            target_kb=target_kb,
            fixed_quality=args.quality,
            max_width=args.max_width,
            max_pixels=args.max_pixels
        )
        print_single_result(res)

    # Batch Directory
    elif in_path.is_dir():
        extensions = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".gif"}
        files = [p for p in in_path.rglob("*") if p.suffix.lower() in extensions]
        if not files:
            print(f"No image files found in directory: {in_path}")
            sys.exit(1)

        out_dir = Path(args.output) if args.output else None
        if out_dir:
            out_dir.mkdir(parents=True, exist_ok=True)

        results = batch_compress(
            files,
            out_dir,
            compressor,
            target_kb=target_kb,
            fixed_quality=args.quality,
            workers=args.workers
        )
        print_batch_summary(results)
    else:
        print(f"Error: Path '{args.input}' does not exist.")
        sys.exit(1)


if __name__ == "__main__":
    main()
