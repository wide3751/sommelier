# 狀態列示意圖

| 檔案 | 用途 |
|---|---|
| `status-line.png` | README.md 的 cache 量表示意圖 |
| `status-line.en.png` | README.en.md 的英文版 |
| `status-line-source.html` | 產生兩版的原始檔，情境與數字寫在裡面 |

重新產生（`l` 為 `zh` 或 `en`，`en` 輸出到 `status-line.en.png`）：

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --virtual-time-budget=4000 \
  --window-size=720,444 --screenshot=status-line.png "file://$PWD/status-line-source.html?lang=zh"
```
