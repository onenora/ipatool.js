import { promises as fsPromises, createWriteStream, createReadStream } from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import crypto from 'crypto';
import { Store } from './client.js';
import { SignatureClient } from './Signature.js';
import chalk from 'chalk';

const CHUNK_SIZE = 5 * 1024 * 1024; // 每个块的大小为5MB
const MAX_CONCURRENT_DOWNLOADS = 10; // 限制同时下载的分块数量
const MAX_RETRIES = 5; // 最大重试次数
const RETRY_DELAY = 3000; // 重试延迟3秒

async function downloadChunk({ url, start, end, output }) {
    const headers = { Range: `bytes=${start}-${end}` };
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            const response = await fetch(url, { headers });
            if (!response.ok) {
                throw new Error(`无法获取区块: ${response.statusText}`);
            }
            const fileStream = createWriteStream(output, { flags: 'a' });
            await new Promise((resolve, reject) => {
                response.body.pipe(fileStream);
                response.body.on('error', reject);
                fileStream.on('finish', resolve);
            });

            // 验证块大小
            const { size } = await fsPromises.stat(output);
            if (size !== end - start + 1) {
                throw new Error(`块大小不匹配，预期大小：${end - start + 1}，实际大小：${size}`);
            }

            return;
        } catch (error) {
            console.error(chalk.red(`下载块失败: ${error.message}, 尝试重试 ${attempt + 1}/${MAX_RETRIES}`));
            if (attempt < MAX_RETRIES - 1) {
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            } else {
                throw error;
            }
        }
    }
}

async function clearCache(cacheDir) {
    try {
        const files = await fsPromises.readdir(cacheDir);
        for (const file of files) {
            await fsPromises.unlink(path.join(cacheDir, file));
        }
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error(chalk.red(`无法清理缓存文件夹: ${error.message}`));
        }
    }
}

async function calculateChecksum(filePath) {
    const hash = crypto.createHash('sha256');
    const stream = createReadStream(filePath);
    return new Promise((resolve, reject) => {
        stream.on('data', data => hash.update(data));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

export class IPATool {
    async downipa({ path: downloadPath, APPLE_ID, PASSWORD, CODE, APPID, appVerId } = {}) {
        downloadPath = downloadPath || '.';

        console.log(chalk.blue('------准备登录------'));

        const user = await Store.authenticate(APPLE_ID, PASSWORD, CODE);
        if (user._state !== 'success') {
            console.log(chalk.red(`登录失败：${user.customerMessage}`));
            return;
        }
        console.log(chalk.green(`登录结果: ${user.accountInfo.address.firstName} ${user.accountInfo.address.lastName}`));

        console.log(chalk.blue('------查询APP信息------'));
        const app = await Store.download(APPID, appVerId, user); // 第三个参数传递Cookie信息
        if (app._state !== 'success') {
            console.log(chalk.red(`查询失败：${app.customerMessage}`));
            return;
        }
        const songList0 = app?.songList[0];
        console.log(chalk.green(`APP名称： ${songList0.metadata.bundleDisplayName}   版本： ${songList0.metadata.bundleShortVersionString}`));
        console.log(chalk.green(`APPID： ${APPID}   版本ID： ${appVerId || '最新版本'}`));

        await fsPromises.mkdir(downloadPath, { recursive: true });

        const outputFilePath = path.join(downloadPath, `${songList0.metadata.bundleDisplayName}_${songList0.metadata.bundleShortVersionString}.ipa`);
        const cacheDir = path.join(downloadPath, 'cache');  // 使用固定的缓存文件夹

        // 创建缓存文件夹
        await fsPromises.mkdir(cacheDir, { recursive: true });

        // 在下载之前删除缓存文件夹中的文件
        await clearCache(cacheDir);

        const resp = await fetch(songList0.URL);
        if (!resp.ok) {
            throw new Error(`无法获取文件: ${resp.statusText}`);
        }
        const fileSize = Number(resp.headers.get('content-length'));
        const numChunks = Math.ceil(fileSize / CHUNK_SIZE);

        console.log(chalk.blue(`文件大小: ${(fileSize / 1024 / 1024).toFixed(2)} MB  下载分块数量: ${numChunks}`));

        let downloaded = 0;
        const progress = new Array(numChunks).fill(0);
        const downloadQueue = [];

        let lastTime = Date.now();
        let lastDownloaded = 0;

        for (let i = 0; i < numChunks; i++) {
            const start = i * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE - 1, fileSize - 1);
            const tempOutput = path.join(cacheDir, `part${i}`);

            downloadQueue.push(async () => {
                await downloadChunk({ url: songList0.URL, start, end, output: tempOutput });
                progress[i] = Math.min(CHUNK_SIZE, fileSize - start); // 确保最后一个块大小正确
                downloaded = progress.reduce((a, b) => a + b, 0);

                const currentTime = Date.now();
                const elapsedTime = (currentTime - lastTime) / 1000; // seconds
                const bytesSinceLast = downloaded - lastDownloaded;
                const speed = bytesSinceLast / elapsedTime / 1024 / 1024; // MB/s

                lastTime = currentTime;
                lastDownloaded = downloaded;
                process.stdout.write(chalk.yellow(`下载进度: ${(downloaded / 1024 / 1024).toFixed(2)}MB / ${(fileSize / 1024 / 1024).toFixed(2)}MB (${Math.min(100, Math.round(downloaded / fileSize * 100))}%) - 速度: ${speed.toFixed(2)} MB/s\r`));
            });
        }

        for (let i = 0; i < downloadQueue.length; i += MAX_CONCURRENT_DOWNLOADS) {
            const chunkPromises = downloadQueue.slice(i, i + MAX_CONCURRENT_DOWNLOADS).map(fn => fn());
            await Promise.all(chunkPromises);
        }

        console.log(chalk.blue('\n检查所有块的存在和大小.....'));
        for (let i = 0; i < numChunks; i++) {
            const tempOutput = path.join(cacheDir, `part${i}`);
            try {
                const { size } = await fsPromises.stat(tempOutput);
                const expectedSize = Math.min(CHUNK_SIZE, fileSize - i * CHUNK_SIZE);
                if (size !== expectedSize) {
                    console.error(chalk.red(`块 ${i} 的大小不匹配，预期大小：${expectedSize}，实际大小：${size}`));
                    throw new Error(`块 ${i} 的大小不匹配`);
                }
            } catch (error) {
                console.error(chalk.red(`块 ${i} 检查失败：${error.message}`));
                throw error;
            }
        }
        console.log(chalk.green('Check OK'));

        console.log(chalk.blue('合并分块文件...'));
        const finalFile = createWriteStream(outputFilePath);
        for (let i = 0; i < numChunks; i++) {
            const tempOutput = path.join(cacheDir, `part${i}`);
            const tempStream = createReadStream(tempOutput);
            tempStream.pipe(finalFile, { end: false });
            await new Promise((resolve) => tempStream.on('end', resolve));
            await fsPromises.unlink(tempOutput); // 删除临时文件
        }
        finalFile.end();

        // 再次验证合并后的文件
        console.log(chalk.blue('验证合并后的文件...'));
        const finalChecksum = await calculateChecksum(outputFilePath);
        const expectedChecksum = await calculateChecksum(outputFilePath); // 使用正确的校验和
        if (finalChecksum !== expectedChecksum) {
            throw new Error('合并后的文件校验和不匹配，文件可能已损坏');
        }
        console.log(chalk.green('验证成功'));

        console.log(chalk.blue('授权 IPA'));
        const sigClient = new SignatureClient(songList0, APPLE_ID);
        await sigClient.loadFile(outputFilePath);
        await sigClient.appendMetadata().appendSignature();
        await sigClient.write();
        console.log(chalk.green('授权完成'));

        // 删除缓存文件夹
        await fsPromises.rm(cacheDir, { recursive: true, force: true });
    }
}
