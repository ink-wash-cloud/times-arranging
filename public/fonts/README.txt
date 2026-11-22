汉仪文黑 85W 字库放到这个目录
==============================

【推荐】用一键命令，下载完直接跑：

    npm run font:install

它会自动在 下载 / 桌面 / 文档 里找字库（压缩包也会自动解压），
裁剪成 woff2（约原来的 1/8），然后放到本目录并告诉你结果。

也可以指定路径：

    npm run font:install -- "C:/Users/你/Downloads/汉仪文黑-85W.ttf"

【手动】把字库文件命名为下面任意一个放到本目录（按优先级）：

    hanyi-wenhei-85w.woff2   <- 首选，体积最小
    hanyi-wenhei-85w.woff
    hanyi-wenhei-85w.otf
    hanyi-wenhei-85w.ttf

放好后 npm run build，构建日志会告诉你结果：

    [字体] 找到字库文件 /fonts/hanyi-wenhei-85w.woff2
    [字体] 未找到字库文件，将使用系统字体（放到 public/fonts/ 即可）

应用里：设置 → 外观与性能 → 字体，会显示当前状态，并可切换
「全站 85W / 仅标题 85W / 系统默认」。


从哪拿字库
----------
汉仪文黑是商业字体，本项目不内置。请到官网获取（需登录并同意个人非商用协议）：

    产品页    https://www.hanyi.com.cn/productdetail.php?id=992&type=0
    许可协议  https://www.hanyi.com.cn/productlist.php/faq-doc-2
    个人须知  https://www.hanyi.com.cn/coupon/faq-doc-1

请自行确认你的授权范围（个人非商用 / 商用授权）后再使用。


体积提示
--------
完整中文字库通常 5–20 MB，手机首次打开要下载一次。裁剪后一般能降到 1–2 MB：

    python -m pip install fonttools brotli
    python scripts/subset-font.py "汉仪文黑-85W.ttf"

裁剪范围是 GB2312 全部 6763 个常用字 + 全角符号 + 本项目源码里出现过的所有字符。
遇到不在字库内的生僻字，会用系统字体接管，**不会出现方框**。


没放字库会怎样
----------------
不会报错、不会出方框。应用会自动回落到系统字体：
Windows 微软雅黑 / macOS 苹方 / Android 思源黑体。

另外：如果电脑上已经安装了汉仪文黑，即使不放字库文件，电脑端也会自动用上它
（字体栈里已列出 汉仪文黑-85W、Hanyi WenHei 85W 等常见族名写法）——
但手机端没有安装，所以手机要生效仍然需要把字库放到本目录。
