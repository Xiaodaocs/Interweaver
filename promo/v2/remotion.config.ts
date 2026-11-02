import { Config } from '@remotion/cli/config';

// 用系统 Chrome，避免 Remotion 自带浏览器下载
Config.setBrowserExecutable('C:/Program Files/Google/Chrome/Application/chrome.exe');
Config.setConcurrency(4);
Config.setOverwriteOutput(true);
// 确定性渲染：像素管线固定
Config.setChromiumOpenGlRenderer('angle');
