"""Secure local Hugging Face login without exposing the token in shell history."""
from getpass import getpass

from huggingface_hub import HfApi, login


def main() -> None:
    token = getpass("Paste the NEW Hugging Face READ token (hidden), then press Enter: ").strip()
    if not token.startswith("hf_"):
        raise SystemExit("Invalid token format. Create a Read token beginning with hf_.")
    try:
        identity = HfApi().whoami(token=token)
    except Exception as error:
        raise SystemExit(f"Hugging Face rejected this token: {error}") from None
    login(token=token, add_to_git_credential=False)
    print(f"Login successful for {identity.get('name') or 'your account'}.")
    print("The token was stored by Hugging Face and was not printed or added to Git.")


if __name__ == "__main__":
    main()
