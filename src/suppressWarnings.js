const originalEmitWarning = process.emitWarning;

process.emitWarning = (warning, type, code, ...args) => {
    if (code === 'DEP0040') {
        // 忽略 punycode 模块的弃用警告
        return;
    }
    // 对于其他警告，调用原始 emitWarning 方法
    return originalEmitWarning(warning, type, code, ...args);
};
