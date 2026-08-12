import json
import sys
import time
import pyautogui
import pygetwindow

pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0.08

def execute(action):
    kind = action['type']
    if kind == 'FOCUS':
        matches = pygetwindow.getWindowsWithTitle(action['windowTitle'])
        if not matches:
            raise RuntimeError('Janela configurada não foi encontrada.')
        window = matches[0]
        if window.isMinimized:
            window.restore()
        window.activate()
        time.sleep(0.35)
    elif kind == 'MOVE':
        pyautogui.moveTo(action['x'], action['y'], duration=0.25)
    elif kind == 'CLICK':
        pyautogui.click(action['x'], action['y'])
    elif kind == 'SELECT_ALL':
        pyautogui.hotkey('ctrl', 'a')
    elif kind == 'TYPE_TEXT':
        pyautogui.write(action['text'], interval=0.04)
    elif kind == 'HIGHLIGHT':
        pyautogui.moveTo(action['x'], action['y'], duration=0.25)
        time.sleep(0.65)
    elif kind == 'DELAY':
        time.sleep(min(action['milliseconds'], 5000) / 1000)
    else:
        raise RuntimeError(f'Ação não permitida: {kind}')

try:
    payload = json.load(sys.stdin)
    for item in payload['actions']:
        execute(item)
    print(json.dumps({'ok': True, 'executed': len(payload['actions'])}))
except pyautogui.FailSafeException:
    print(json.dumps({'ok': False, 'error': 'Failsafe acionado pelo usuário.'}))
    sys.exit(2)
except Exception as error:
    print(json.dumps({'ok': False, 'error': str(error)}))
    sys.exit(1)
