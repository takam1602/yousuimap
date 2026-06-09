# 勘翁マップ アプリ

https://yousuimap.vercel.app/

よく用水路を巡っているときに、地図一覧で写真をみることが出来て、簡単なメモを一緒にみることが出来たらなぁと思うことがよくあった。
google map でやってたけど、ピン数が300を超えてくると、挙動が不安定でmap app では表示できなくなってしまった。

機能としては本当に単純で、open street mapを表示して，地図にピンを立てて，写真と説明を追加していく、ものです。

typescript触ったことがなかったので、その勉強のためにGPT先生に助けてもらって作成しています。

DBやAuthは[supabase](https://supabase.com/)の力を借りて、アプリのホスティングは[vercel](https://vercel.com/)にお世話になっています。
すごい世の中になったもんだ... ありがてぇ... 

# 最近の更新
セキュリティがガバっかったのですが、オレオレでgithub 認証みたいなのだけつけました。
認証された人(現在は私だけ)が編集権限を持ち、その他の人は閲覧専用になっている、ハズです。

# 今後のtodo

用水路は幹線や支線に分かれているので、位置情報や写真情報と一緒にタグ付けができそう。なので、あとからデータをソートできるように、構造化データのグリッドみたいなのをウェブでも表示できるようにしてみたい。

あとは、supabaseがどの程度まで写真を保存することができるか、だねぇ。


# 運用メモ

## 編集権限

地図の閲覧は誰でもできますが、地点・画像の追加、更新、削除は Supabase のログインセッションを API 側で検証しています。特定のメールアドレスだけに編集を絞る場合は、Vercel の環境変数に `SUPABASE_EDITOR_EMAILS` を設定してください。複数人の場合はカンマ区切りです。未設定の場合は、ログイン済みユーザーを編集可能として扱います。

必要な環境変数は以下です。

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_EDITOR_EMAILS` 任意

## Supabase Keep Alive

`.github/workflows/keep-alive.yml` で毎日 Supabase REST API を叩きます。GitHub Actions の scheduled workflow は、リポジトリの活動が長期間ない場合に GitHub 側で無効化されることがあります。その場合は GitHub の Actions 画面で workflow を enable し、`Run workflow` で手動実行してください。

Workflow には GitHub Secrets として以下が必要です。

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`


## 複数マップのデータ分離

複数の用水路マップは `notes.map_slug` で分離します。既存の土浦用水データは `tsuchiura-yosui` として扱います。Supabase に反映する SQL は `supabase/migrations/20260609000000_add_map_slug_to_notes.sql` です。

現在登録しているマップは以下です。

- `tsuchiura-yosui`: 土浦用水
- `kasumigaura-yosui`: 霞ヶ浦用水
- `minuma-daiyosui`: 見沼代用水
- `ishioka-daichi-yosui`: 石岡台地用水

新しいマップを追加する場合は `src/lib/waterwayMaps.ts` に設定を追加してください。
