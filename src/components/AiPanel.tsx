import React, { useEffect, useState } from 'react';
import { Field, toast } from './ui';
import { ai, loadAiConfig, saveAiConfig, testAiConnection, aiReady } from '../lib/ai';
import { t, useLang } from '../lib/i18n';

/** 常见服务商的填法，点一下就把地址和模型填好 */
const PRESETS: Array<{ label: string; baseUrl: string; model: string; hint: string }> = [
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', hint: '便宜好用，但看不了图片' },
  { label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-vl-max', hint: 'qwen-vl-max 能直接认课表截图' },
  { label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4v-plus', hint: 'glm-4v-plus 支持看图' },
  { label: '本地 Ollama', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5vl:7b', hint: '不联网、不花钱，需要显存' }
];

/**
 * AI 识别配置。
 *
 * 密钥只存在本机 IndexedDB 里，不同步到服务器，也不进备份文件——
 * 这东西泄露了别人能直接拿去花钱。
 */
export default function AiPanel() {
  useLang();
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  // aiReady() 读的是模块级对象，保存之后 React 不会自己重渲染，
  // 状态标签就会一直停在"未配置"——用一份本地副本驱动界面
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadAiConfig().then(() => {
      setBaseUrl(ai.baseUrl);
      setApiKey(ai.apiKey);
      setModel(ai.model);
      setReady(aiReady());
    });
  }, []);

  const save = async () => {
    await saveAiConfig({ baseUrl, apiKey, model });
    setReady(aiReady());
    toast(t('AI 配置已保存（仅存本机，不上传服务器）'), 'ok');
  };

  const test = async () => {
    await saveAiConfig({ baseUrl, apiKey, model });
    setTesting(true);
    try {
      const reply = await testAiConnection();
      toast(t('连接成功，模型回复：{reply}', { reply }), 'ok');
    } catch (e) {
      toast(t('连接失败：{msg}', { msg: String((e as Error).message || e) }), 'err');
    } finally {
      setTesting(false);
    }
  };

  const usePreset = (p: typeof PRESETS[number]) => {
    setBaseUrl(p.baseUrl);
    setModel(p.model);
    setReady(true);
    toast(t('已填入 {name} 的地址和模型，还需要填 API Key', { name: t(p.label) }), 'info');
  };

  return (
    <div className="card mb12">
      <div className="card-h">
        <span className="ico">🤖</span>
        <h3>{t('AI 识别')}</h3>
        <div className="right">
          {ready
            ? <span className="chip static on">{t('已配置')}</span>
            : <span className="chip static">{t('未配置')}</span>}
        </div>
      </div>

      <div className="muted mb12" style={{ lineHeight: 1.9 }}>
        {t('配上之后，课表可以')}<b>{t('直接把课表截图 / 相册照片丢进来')}</b>{t('，AI 认出课程、教师、地点、节次和周次，自动排进课表。教务系统复制出来的一坨乱文本也能认。')}<br />
        {t('接口是 OpenAI 兼容格式，DeepSeek、通义、智谱、本地 Ollama 都能用。')}
        <b>{t('不配也能用')}</b>{t('：文本和 Excel 会走本地规则解析，只是认不了图片。')}
      </div>

      <div className="row-wrap mb12">
        <span className="muted">{t('快速填入：')}</span>
        {PRESETS.map((p) => (
          <button key={p.label} className="chip" onClick={() => usePreset(p)} title={t(p.hint)}>{t(p.label)}</button>
        ))}
      </div>

      <Field label={t('接口地址')} full hint={t('OpenAI 兼容的 base url。带不带 /v1 都行，程序会自己补 /chat/completions')}>
        <input className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://api.deepseek.com/v1" />
      </Field>

      <div className="form-grid">
        <Field label="API Key" hint={t('只保存在这台设备上，不参与同步、不进备份')}>
          <div className="row-wrap">
            <input className="input" style={{ flex: 1, minWidth: 0 }} type={showKey ? 'text' : 'password'}
              value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." />
            <button className="btn btn-sm btn-ghost" onClick={() => setShowKey((v) => !v)}>
              {showKey ? t('隐藏') : t('显示')}
            </button>
          </div>
        </Field>
        <Field label={t('模型名')} hint={t('图片识别要选带视觉能力的模型，例如 qwen-vl-max、glm-4v-plus、gpt-4o')}>
          <input className="input" value={model} onChange={(e) => setModel(e.target.value)}
            placeholder="deepseek-chat" />
        </Field>
      </div>

      <div className="row-wrap mt12">
        <button className="btn btn-primary" onClick={save}>{t('保存')}</button>
        <button className="btn" onClick={test} disabled={testing}>
          {testing ? t('测试中…') : t('测试连接')}
        </button>
        <span className="muted">{t('测试会真的发一次请求，用来确认地址、密钥、模型名都对')}</span>
      </div>
    </div>
  );
}
