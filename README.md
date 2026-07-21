# Voice2Text

语音转文字 Web 服务 | 支持多家 ASR 供应商

## 供应商配置

通过 Cloudflare Pages 环境变量配置 API 密钥：

| 环境变量 | 说明 | 必需 |
|---------|------|------|
| `TENCENT_SECRET_ID` | 腾讯云 SecretId | 腾讯云 |
| `TENCENT_SECRET_KEY` | 腾讯云 SecretKey | 腾讯云 |
| `ALIYUN_ACCESS_KEY_ID` | 阿里云 AccessKeyId | 阿里云 |
| `ALIYUN_ACCESS_KEY_SECRET` | 阿里云 AccessKeySecret | 阿里云 |
| `ALIYUN_ASR_APP_KEY` | 阿里云 ASR AppKey | 阿里云 |
| `OPENAI_API_KEY` | OpenAI API Key | OpenAI |

## 部署到 Cloudflare Pages

1. 推代码到 GitHub
2. Cloudflare Pages 连接 GitHub 仓库
3. 构建设置留空（纯静态 + Workers Function）
4. 在 Cloudflare Pages 设置中添加环境变量
5. 绑定自定义域名 voice2222text.xyz
