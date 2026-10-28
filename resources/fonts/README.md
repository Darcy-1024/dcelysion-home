# MiSans 构建源文件

`MiSansVF.woff2` 是原 `public/assets/fonts/MiSansVF.woff2` 的逐字节副本，用于可复现分包，不随静态站点部署。

- SHA-256：`f315c0ea1d09d5181a745104c637fd3f3c12a81244b10c099c5180639fb71b52`
- 来源：项目原有博客同步字体；此次未升级字体版本或修改字形设计。
- 许可：本目录和 `public/assets/fonts/MiSans-License.pdf` 保留了从小米官方网站下载的许可原文；本站使用 MiSans 字体。
- 生成方法：`scripts/split-font.py`，依赖固定于 `scripts/font-requirements.txt`。
- 生成产物带内容哈希，保留完整字符覆盖、字体名称/版权记录及可变字重；源码字体不应删除，否则无法独立重建。
