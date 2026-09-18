#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
local_root="$repo_root/.diffusatory"
config_file="$repo_root/diffusatory-user.sh"

if [[ -f "$config_file" ]]; then
    # This is an operator-owned local Bash configuration file. It is ignored
    # by Git and may define DIFFUSATORY_EXTRA_ARGS as a Bash array.
    # shellcheck source=/dev/null
    source "$config_file"
fi

access_mode=${DIFFUSATORY_ACCESS_MODE:-both}
host=${DIFFUSATORY_HOST:-127.0.0.1}
port=${DIFFUSATORY_PORT:-7865}
runtime_dir=${DIFFUSATORY_RUNTIME_DIR:-$local_root/runtime}
token_file=${DIFFUSATORY_API_TOKEN_FILE:-$runtime_dir/api-token}
ui_token_file=${DIFFUSATORY_UI_TOKEN_FILE:-$runtime_dir/ui-token}
log_file=${DIFFUSATORY_LOG_FILE:-$runtime_dir/server.log}
tls_cert=${DIFFUSATORY_TLS_CERTFILE:-}
tls_key=${DIFFUSATORY_TLS_KEYFILE:-}

usage() {
    cat <<'EOF'
Usage: ./diffusatory.sh [Forge launch arguments]

Build and launch the complete Diffusatory workbench.

Local configuration may be stored in diffusatory-user.sh:
  DIFFUSATORY_ACCESS_MODE=both   # ui, api, or both
  DIFFUSATORY_HOST=127.0.0.1
  DIFFUSATORY_PORT=7865
  DIFFUSATORY_TLS_CERTFILE=/path/to/cert.pem
  DIFFUSATORY_TLS_KEYFILE=/path/to/key.pem
  DIFFUSATORY_LOG_FILE=/path/to/server.log
  DIFFUSATORY_PYTHON=python3.14
  DIFFUSATORY_EXTRA_ARGS=(--xformers)

An API token is created automatically for api/both mode. Its value is never
printed. Pass additional Forge arguments after the command when needed.
EOF
}

if [[ ${1:-} == "--help" || ${1:-} == "-h" ]]; then
    usage
    exit 0
fi

case "$access_mode" in
    ui|api|both) ;;
    *)
        printf 'Diffusatory: invalid access mode %q (expected ui, api, or both)\n' "$access_mode" >&2
        exit 2
        ;;
esac

python_is_supported() {
    "$1" -c 'import sys; raise SystemExit(sys.version_info[:2] < (3, 11))' \
        >/dev/null 2>&1
}

select_python() {
    local candidate
    if [[ -n ${DIFFUSATORY_PYTHON:-} ]]; then
        if command -v "$DIFFUSATORY_PYTHON" >/dev/null 2>&1 && \
           python_is_supported "$DIFFUSATORY_PYTHON"; then
            printf '%s\n' "$DIFFUSATORY_PYTHON"
            return 0
        fi
        printf 'Diffusatory: DIFFUSATORY_PYTHON must select Python 3.11 or newer\n' >&2
        return 1
    fi
    for candidate in python3 python3.14 python3.13 python3.12 python3.11; do
        if command -v "$candidate" >/dev/null 2>&1 && python_is_supported "$candidate"; then
            printf '%s\n' "$candidate"
            return 0
        fi
    done
    printf 'Diffusatory: Python 3.11 or newer is required\n' >&2
    return 1
}

if [[ -x "$repo_root/venv/bin/python" ]]; then
    if ! python_is_supported "$repo_root/venv/bin/python"; then
        current_python=$(
            "$repo_root/venv/bin/python" -c \
                'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' \
                2>/dev/null || printf unknown
        )
        printf 'Diffusatory: existing venv uses Python %s; recreate it with Python 3.11 or newer\n' \
            "$current_python" >&2
        exit 2
    fi
    python_cmd="$repo_root/venv/bin/python"
else
    python_cmd=$(select_python)
fi

if [[ ! "$port" =~ ^[0-9]+$ ]] || (( port < 1 || port > 65535 )); then
    printf 'Diffusatory: invalid port %q\n' "$port" >&2
    exit 2
fi

if [[ -n "$tls_cert" || -n "$tls_key" ]]; then
    if [[ -z "$tls_cert" || -z "$tls_key" ]]; then
        printf 'Diffusatory: HTTPS requires both DIFFUSATORY_TLS_CERTFILE and DIFFUSATORY_TLS_KEYFILE\n' >&2
        exit 2
    fi
    if [[ ! -f "$tls_cert" || ! -f "$tls_key" ]]; then
        printf 'Diffusatory: HTTPS certificate or key file does not exist\n' >&2
        exit 2
    fi
fi

mkdir -p "$runtime_dir"
chmod 700 "$runtime_dir"

if [[ "$access_mode" == "api" || "$access_mode" == "both" ]]; then
    if [[ -n "${DIFFUSATORY_API_TOKEN:-}" ]]; then
        mkdir -p "$(dirname -- "$token_file")"
        previous_umask=$(umask)
        umask 077
        printf '%s\n' "$DIFFUSATORY_API_TOKEN" > "$token_file"
        umask "$previous_umask"
    elif [[ ! -s "$token_file" ]]; then
        mkdir -p "$(dirname -- "$token_file")"
        previous_umask=$(umask)
        umask 077
        "$python_cmd" -c 'import secrets; print(secrets.token_urlsafe(32))' > "$token_file"
        umask "$previous_umask"
    fi
    chmod 600 "$token_file"
    export DIFFUSATORY_API_TOKEN_FILE="$token_file"
fi

if [[ "$access_mode" == "ui" || "$access_mode" == "both" ]]; then
    if [[ -n "${DIFFUSATORY_UI_TOKEN:-}" ]]; then
        mkdir -p "$(dirname -- "$ui_token_file")"
        previous_umask=$(umask)
        umask 077
        printf '%s\n' "$DIFFUSATORY_UI_TOKEN" > "$ui_token_file"
        umask "$previous_umask"
    elif [[ ! -s "$ui_token_file" ]]; then
        mkdir -p "$(dirname -- "$ui_token_file")"
        previous_umask=$(umask)
        umask 077
        "$python_cmd" -c 'import secrets; print(secrets.token_urlsafe(32))' > "$ui_token_file"
        umask "$previous_umask"
    fi
    chmod 600 "$ui_token_file"
    export DIFFUSATORY_UI_TOKEN_FILE="$ui_token_file"
fi

mkdir -p "$(dirname -- "$log_file")"
touch "$log_file"
chmod 600 "$log_file"
exec > >(tee -a "$log_file") 2>&1
printf 'Diffusatory: appending server output to %s\n' "$log_file"

if [[ "$access_mode" != "api" ]]; then
    web_root="$repo_root/diffusatory/web"
    if [[ ! -f "$web_root/node_modules/.modules.yaml" || \
          "$web_root/package.json" -nt "$web_root/node_modules/.modules.yaml" || \
          "$web_root/pnpm-lock.yaml" -nt "$web_root/node_modules/.modules.yaml" ]]; then
        printf 'Diffusatory: installing client dependencies\n'
        (cd "$web_root" && pnpm install --frozen-lockfile)
    fi
    printf 'Diffusatory: building client\n'
    (cd "$web_root" && pnpm build)
fi

launch_args=(
    --api
    --port "$port"
    --server-name "$host"
    --diffusatory-access "$access_mode"
)

if [[ -n "$tls_cert" ]]; then
    launch_args+=(--tls-certfile "$tls_cert" --tls-keyfile "$tls_key")
fi

if declare -p DIFFUSATORY_EXTRA_ARGS &>/dev/null; then
    if [[ $(declare -p DIFFUSATORY_EXTRA_ARGS) != "declare -a"* ]]; then
        printf 'Diffusatory: DIFFUSATORY_EXTRA_ARGS must be a Bash array\n' >&2
        exit 2
    fi
    launch_args+=("${DIFFUSATORY_EXTRA_ARGS[@]}")
fi
launch_args+=("$@")

scheme=http
[[ -n "$tls_cert" ]] && scheme=https
printf 'Diffusatory: %s://%s:%s/diffusatory/ (%s access)\n' \
    "$scheme" "$host" "$port" "$access_mode"
if [[ "$access_mode" == "api" || "$access_mode" == "both" ]]; then
    printf 'Diffusatory: bearer token stored at %s\n' "$token_file"
fi

cd "$repo_root"
if [[ -x venv/bin/python ]]; then
    prepare_args=(--skip-prepare-environment --skip-version-check)
    if [[ ${DIFFUSATORY_PREPARE_ENVIRONMENT:-0} == 1 ]]; then
        prepare_args=()
    fi
    exec venv/bin/python -u launch.py "${prepare_args[@]}" "${launch_args[@]}"
fi

export python_cmd
exec ./webui.sh "${launch_args[@]}"
