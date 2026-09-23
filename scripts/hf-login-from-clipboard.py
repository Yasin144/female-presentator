"""Authenticate Hugging Face from the current clipboard without printing the token."""
import tkinter as tk

from huggingface_hub import HfApi, login


def main() -> None:
    root = tk.Tk()
    root.withdraw()
    try:
        token = root.clipboard_get().strip()
    finally:
        root.destroy()
    if not token.startswith("hf_") or any(character.isspace() for character in token):
        raise SystemExit("CLIPBOARD_TOKEN_INVALID")
    try:
        identity = HfApi().whoami(token=token)
        login(token=token, add_to_git_credential=False)
    except Exception:
        raise SystemExit("HF_TOKEN_REJECTED") from None
    print("HF_LOGIN_SUCCESS")
    print("HF_USER=" + str(identity.get("name") or "authenticated"))


if __name__ == "__main__":
    main()
