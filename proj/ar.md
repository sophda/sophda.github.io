# 安卓增强现实系统
## 系统框架图
![img](src/ARFW.png)
- PC端：orbslam3建图，ACE模型训练与量化
- Android端：模型渲染，运行IMU_MONOCULAR ORBSLAM3，ACE模型单目重定位（LibTorch推理）
## AR效果展示：
![img](src/app20250825_140005.gif)