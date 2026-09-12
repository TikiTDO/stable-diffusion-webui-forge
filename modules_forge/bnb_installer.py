from importlib.metadata import PackageNotFoundError, version

from modules.launch_utils import run_pip

target_bitsandbytes_version = '0.50.2'


def try_install_bnb():
    try:
        bitsandbytes_version = version('bitsandbytes')
    except PackageNotFoundError:
        bitsandbytes_version = None

    try:
        if bitsandbytes_version != target_bitsandbytes_version:
            run_pip(
                f"install -U bitsandbytes=={target_bitsandbytes_version}",
                f"bitsandbytes=={target_bitsandbytes_version}",
            )
    except Exception as e:
        print(f'Cannot install bitsandbytes. Skipped.')
