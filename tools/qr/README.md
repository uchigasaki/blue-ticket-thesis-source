# QRコード生成ツール

指定したHTTP(S) URLから、PNG・SVGのQRコードと画像仕様を記したJSONをローカルに生成します。URLへのアクセスは行いません。

Python 3.10以上の環境で、次のコマンドを実行します。

```shell
python -m pip install -r requirements.txt
python generate_qr.py https://example.invalid/study --output-prefix ./example-qr
```

上の例では、`example-qr.png`、`example-qr.svg`、`example-qr.json` を生成します。出力先のフォルダーは先に作成してください。既存のファイルは上書きしません。JSONにはURLを記載しませんが、生成したPNG・SVGには入力したURLが符号化されます。
