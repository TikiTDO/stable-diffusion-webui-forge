from contextlib import closing

from PIL import Image
import gradio as gr

from modules import images, layered_canvas
from modules.infotext_utils import create_override_settings_dict
from modules.processing import StableDiffusionProcessingImg2Img, process_images
from modules.shared import opts
import modules.shared as shared
from modules.ui import plaintext_to_html
import modules.scripts
from modules_forge import main_thread


def img2img_function(id_task: str, request: gr.Request, mode: int, prompt: str, negative_prompt: str, prompt_styles, editor, mask_blur: int, inpainting_fill: int, n_iter: int, batch_size: int, cfg_scale: float, distilled_cfg_scale: float, image_cfg_scale: float, denoising_strength: float, selected_scale_tab: int, height: int, width: int, scale_by: float, resize_mode: int, inpaint_full_res: bool, inpaint_full_res_padding: int, inpainting_mask_invert: int, override_settings_texts, *args):

    override_settings = create_override_settings_dict(override_settings_texts)

    height, width = int(height), int(width)

    image = layered_canvas.source_and_paint(editor)
    mask = layered_canvas.inpaint_mask(editor) if mode == 1 else None

    if mask and isinstance(mask, Image.Image):
        mask = mask.point(lambda v: 255 if v > 128 else 0)

    image = images.fix_image(image)
    mask = images.fix_image(mask)

    if selected_scale_tab == 1:
        assert image, "Can't scale by because no image is selected"

        width = int(image.width * scale_by)
        width -= width % 8
        height = int(image.height * scale_by)
        height -= height % 8

    assert 0. <= denoising_strength <= 1., 'can only work with strength in [0.0, 1.0]'

    p = StableDiffusionProcessingImg2Img(
        outpath_samples=opts.outdir_samples or opts.outdir_img2img_samples,
        outpath_grids=opts.outdir_grids or opts.outdir_img2img_grids,
        prompt=prompt,
        negative_prompt=negative_prompt,
        styles=prompt_styles,
        batch_size=batch_size,
        n_iter=n_iter,
        cfg_scale=cfg_scale,
        width=width,
        height=height,
        init_images=[image],
        mask=mask,
        mask_blur=mask_blur,
        inpainting_fill=inpainting_fill,
        resize_mode=resize_mode,
        denoising_strength=denoising_strength,
        image_cfg_scale=image_cfg_scale,
        inpaint_full_res=inpaint_full_res,
        inpaint_full_res_padding=inpaint_full_res_padding,
        inpainting_mask_invert=inpainting_mask_invert,
        override_settings=override_settings,
        distilled_cfg_scale=distilled_cfg_scale
    )

    p.scripts = modules.scripts.scripts_img2img
    p.script_args = args

    p.user = request.username

    if shared.opts.enable_console_prompts:
        print(f"\nimg2img: {prompt}", file=shared.progress_print_out)

    with closing(p):
        processed = modules.scripts.scripts_img2img.run(p, *args)
        if processed is None:
            processed = process_images(p)

    shared.total_tqdm.clear()

    generation_info_js = processed.js()
    if opts.samples_log_stdout:
        print(generation_info_js)

    if opts.do_not_show_images:
        processed.images = []

    return processed.images + processed.extra_images, generation_info_js, plaintext_to_html(processed.info), plaintext_to_html(processed.comments, classname="comments")


def img2img(id_task: str, request: gr.Request, *args):
    """Keep Gradio's injected request in the public callback signature.

    Gradio discovers request injection from the ``gr.Request`` annotation.  A
    catch-all ``*args`` wrapper therefore shifts every submitted component one
    position to the left: the workflow value becomes ``request``, the prompt
    becomes ``mode``, and the editor never reaches ``editor``.  Keep the two
    leading arguments explicit before handing execution to Forge's main
    thread.
    """
    return main_thread.run_and_wait_result(img2img_function, id_task, request, *args)
