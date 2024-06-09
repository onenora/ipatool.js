# 代码参考来源
https://github.com/beerpiss/ipatool.ts


## 功能
只有下载ipa功能，没有查询版本号，和购买功能
下载【新版、旧版、包含已经下架的新旧版APP】，前提是自己曾经下载过


### 用法

~~测试环境：windows   Node.js 18.16.1~~

*测试环境：macOS Sonoma14.5  Node.js v22.2.0*

安装模块
```js
npm i
```

- ~win~ *Mac* 编辑main.js 然后运行批处理即可

或者运行以下命令(win/mac/linux)

```js
node main.js
```
### 美化
- `加了个chalk，美化了一下终端输出样式`

<img src="https://raw.githubusercontent.com/onenora/picgo/main/img/xiangse.png" alt="Example Image" width="45%">

- 结构

```
ipatool.js/
├── .env
├── main.js
├── package.json
├── src/
│   ├── client.js
│   ├── ipa.js
│   ├── Signature.js
│   └── suppressWarnings.js
└── node_modules/
```
`密码放在.env中了，懒的调试完git push还要删除密码和账号` 

`其中，.env 文件包含你的敏感信息：`

```plaintext
APPLE_ID=your_apple_id@foxmail.com
PASSWORD=your_password
```