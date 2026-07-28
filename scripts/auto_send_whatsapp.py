import sys
import os
import time
import json
import urllib.request
import urllib.parse
import subprocess
import pyautogui
import pygetwindow as gw

def main():
    if len(sys.argv) < 2:
        return
    if sys.argv[1] == "--message":
        if len(sys.argv) < 3:
            return
        message = sys.argv[2].strip()
        phone_number = sys.argv[3].strip() if len(sys.argv) > 3 else "917386726193"
        if not message:
            return
    else:
        mobile_url = sys.argv[1].strip()
        if not mobile_url or not mobile_url.startswith('http'):
            return
        wifi_url = sys.argv[2].strip() if len(sys.argv) > 2 else "http://192.168.29.161:8433"
        phone_number = sys.argv[3].strip() if len(sys.argv) > 3 else "917386726193"
        message = f"📱 Presentator 4G/5G Mobile Link:\n{mobile_url}\n\n🏠 Home Wi-Fi Link:\n{wifi_url}"

    # 1. Instant Push Notification to Phone via ntfy.sh (Zero login, 0ms latency)
    try:
        req = urllib.request.Request("https://ntfy.sh/pattan_7386726193", data=message.encode('utf-8'))
        urllib.request.urlopen(req, timeout=5)
        print("[Auto-Send] Instant push notification sent to ntfy.sh/pattan_7386726193")
    except Exception as e:
        print("[Auto-Send] Push error:", e)

    # 2. Native WhatsApp URI + pygetwindow Auto Focus + PyAutoGUI Auto Send
    try:
        encoded_text = urllib.parse.quote(message)
        wa_app_url = f"whatsapp://send?phone={phone_number}&text={encoded_text}"

        if sys.platform == 'win32':
            os.system(f'start "" "{wa_app_url}"')
            
            time.sleep(3.5)

            # Find matching window and bring to foreground
            matching_wins = [w for w in gw.getAllWindows() if any(k in w.title.lower() for k in ['whatsapp', 'chrome', 'edge'])]
            for win in matching_wins:
                try:
                    win.activate()
                    time.sleep(0.3)
                    pyautogui.press('enter')
                    pyautogui.hotkey('ctrl', 'enter')
                    pyautogui.press('enter')
                except Exception:
                    pass

            # Fallback SendKeys
            vbs_code = '''
Set w = CreateObject("WScript.Shell")
w.AppActivate "WhatsApp"
w.AppActivate "Chrome"
w.AppActivate "Edge"
WScript.Sleep 500
w.SendKeys "~"
w.SendKeys "^{ENTER}"
w.SendKeys "~"
'''
            temp_dir = os.path.join(os.path.dirname(__file__), '..', 'temp')
            os.makedirs(temp_dir, exist_ok=True)
            vbs_file = os.path.join(temp_dir, '_send_wa_focused.vbs')
            with open(vbs_file, 'w') as f:
                f.write(vbs_code)
            subprocess.run(['cscript', '//nologo', vbs_file], capture_output=True)

            print(f"[Auto-Send] WhatsApp auto-send completed for {phone_number}")
    except Exception as e:
        print("[Auto-Send] WhatsApp error:", e)

if __name__ == '__main__':
    main()
