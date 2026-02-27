# 安卓聊天机器人

![app20260203_202954](src/app20260203_202954.gif)

## 大模型微调
基于llama-factory微调qwen2.5 1.5B模型，并合并权重

## 推理
使用 MNN 框架，使模型在手机上推理

## UI
使用kotlin，实现聊天气泡、打字机效果



TODO:

- kotlin方法在c++端注册回调，使得每次输出一个token就在ui界面显示

