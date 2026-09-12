import launch
import os
import shutil
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Optional

from packaging.version import Version


repo_root = Path(__file__).parent
main_req_file = repo_root / "requirements.txt"


def comparable_version(package_version: str) -> Version:
    return Version(package_version)


def get_installed_version(package: str) -> Optional[str]:
    try:
        return version(package)
    except PackageNotFoundError:
        return None


def extract_base_package(package_string: str) -> str:
    base_package = package_string.split("@git")[0]
    return base_package


def install_requirements(req_file):
    with open(req_file) as file:
        for package in file:
            try:
                package = package.strip()
                if "==" in package:
                    package_name, package_version = package.split("==")
                    installed_version = get_installed_version(package_name)
                    if installed_version != package_version:
                        launch.run_pip(
                            f"install -U {package}",
                            f"forge_legacy_preprocessor requirement: changing {package_name} version from {installed_version} to {package_version}",
                        )
                elif ">=" in package:
                    package_name, package_version = package.split(">=")
                    installed_version = get_installed_version(package_name)
                    if not installed_version or comparable_version(
                        installed_version
                    ) < comparable_version(package_version):
                        launch.run_pip(
                            f"install -U {package}",
                            f"forge_legacy_preprocessor requirement: changing {package_name} version from {installed_version} to {package_version}",
                        )
                elif not launch.is_installed(extract_base_package(package)):
                    launch.run_pip(
                        f"install {package}",
                        f"forge_legacy_preprocessor requirement: {package}",
                    )
            except Exception as e:
                print(e)
                print(
                    f"Warning: Failed to install {package}, some preprocessors may not work."
                )


def try_install_from_wheel(pkg_name: str, wheel_url: str, version: Optional[str] = None):
    current_version = get_installed_version(pkg_name)
    if current_version is not None:
        # No version requirement.
        if version is None:
            return
        # Version requirement already satisfied.
        if comparable_version(current_version) >= comparable_version(version):
            return
    try:
        launch.run_pip(
            f"install -U {wheel_url}",
            f"forge_legacy_preprocessor requirement: {pkg_name}",
        )
    except Exception as e:
        print(e)
        print(f"Warning: Failed to install {pkg_name}. Some processors will not work.")


def try_install_insight_face():
    """Install the portable InsightFace release used by FaceID preprocessors."""
    package = os.environ.get("INSIGHTFACE_WHEEL", "insightface==2.0")
    required_version = None if "INSIGHTFACE_WHEEL" in os.environ else "2.0"
    try_install_from_wheel("insightface", package, version=required_version)


def try_remove_legacy_submodule():
    """Try remove annotators/hand_refiner_portable submodule dir."""
    submodule = repo_root / "annotator" / "hand_refiner_portable"
    if os.path.exists(submodule):
        try:
            shutil.rmtree(submodule)
        except Exception as e:
            print(e)
            print(
                f"Failed to remove submodule {submodule} automatically. You can manually delete the directory."
            )


install_requirements(main_req_file)
try_install_insight_face()
try_install_from_wheel(
    "handrefinerportable",
    wheel_url=os.environ.get(
        "HANDREFINER_WHEEL",
        "https://github.com/huchenlei/HandRefinerPortable/releases/download/v1.0.1/handrefinerportable-2024.2.12.0-py2.py3-none-any.whl",
    ),
    version="2024.2.12.0",
)
try_install_from_wheel(
    "depth_anything",
    wheel_url=os.environ.get(
        "DEPTH_ANYTHING_WHEEL",
        "https://github.com/huchenlei/Depth-Anything/releases/download/v1.0.0/depth_anything-2024.1.22.0-py2.py3-none-any.whl",
    ),
)

try_install_from_wheel(
    "depth_anything_v2",
    wheel_url=os.environ.get(
        "DEPTH_ANYTHING_V2_WHEEL",
        "https://github.com/MackinationsAi/UDAV2-ControlNet/releases/download/v1.0.0/depth_anything_v2-2024.7.1.0-py2.py3-none-any.whl",
    ),
)

try_remove_legacy_submodule()
