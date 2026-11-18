# 圆桌演出素材

`court-props.png` 是 ImageGen 生成的 1536 × 1024 透明图集原件。等分为三列、两行，从左至右依次为信函、盾、水盆、翠金冠、铁冠、卷轴。演出视野分别加载背景、道具格、人物立绘、任务牌和光效。图集坐标在 `web/cinematics.css` 中维护。

生成提示词为 Arthurian oil-painting prop atlas, three columns by two rows, genuine transparent alpha, generous padded cells. First row contains an ivory wax-sealed letter, jade heraldic shield and silver water bowl. Second row contains antique gold crown, forged iron crown and ivory scroll. No text or background.

在项目根目录运行以下命令可重新生成客户端素材。

```sh
ffmpeg -i art/cinematics/source/court-props.png -filter:v scale=1296:864:flags=lanczos -vcodec libwebp -quality 86 -compression_level 6 art/cinematics/court-props.webp
python tools/generate-cinematic-audio.py
```

各音轨的声源与动作时间以生成脚本为准。翻页、蜡封、盾落、注水和冠冕分别合成。相同私密动作的音色和时序一致。
