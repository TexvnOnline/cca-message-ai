import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const svg = readFileSync("icons/icon.svg", "utf8");
const iconUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
const browser = await chromium.launch({ headless: true });

try {
  for (const size of [16, 32, 48, 128]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<style>*{box-sizing:border-box}html,body{margin:0;width:${size}px;height:${size}px}img{display:block;width:${size}px;height:${size}px}</style><img src="${iconUrl}" alt="" />`);
    await page.locator("img").screenshot({ path: `icons/icon${size}.png` });
    await page.close();
  }

  const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });
  await page.setContent(`
    <style>
      *{box-sizing:border-box}html,body{margin:0;width:1280px;height:640px}
      body{font-family:Arial,sans-serif;color:#fff;background:#0a1728}
      .card{position:relative;width:1280px;height:640px;overflow:hidden;background:radial-gradient(circle at 78% 42%,#105c72 0,transparent 36%),linear-gradient(120deg,#0a1728,#102944)}
      .card:before{content:"";position:absolute;inset:0;background-image:linear-gradient(#83d8db14 1px,transparent 1px),linear-gradient(90deg,#83d8db14 1px,transparent 1px);background-size:64px 64px}
      .brand{position:absolute;top:62px;left:72px;display:flex;align-items:center;gap:18px;font-size:32px;font-weight:800}
      .brand img{width:60px;height:60px}
      h1{position:absolute;left:72px;top:163px;width:640px;margin:0;font-size:63px;line-height:1.09;letter-spacing:-2.5px}
      h1 span{color:#57e0dc}
      .sub{position:absolute;left:75px;top:397px;width:570px;color:#c6d8e4;font-size:22px;line-height:1.45}
      .tags{position:absolute;left:72px;bottom:57px;display:flex;gap:11px}
      .tags span{padding:9px 14px;border:1px solid #78cbd080;border-radius:24px;background:#1c51604d;color:#ddf8f7;font-size:17px}
      .chat{position:absolute;right:67px;top:156px;width:440px;height:340px;border:1px solid #6699a099;border-radius:18px;background:#e7f4f0;box-shadow:0 30px 70px #0005;transform:rotate(3deg)}
      .top{height:64px;padding:21px 25px;background:#fff;border-radius:18px 18px 0 0;color:#21394a;font-size:18px;font-weight:700}
      .message{margin:40px 24px 0 50px;padding:17px 18px;border-radius:14px;background:#fff;color:#314653;font-size:17px;line-height:1.42}
      .actions{display:flex;gap:9px;margin:22px 24px;color:#126f74}
      .actions span{padding:9px 12px;border:1px solid #9cd5d4;border-radius:20px;background:#fff;font-size:16px;font-weight:700}
      .actions span:last-child{background:#d9f8f1}
    </style>
    <div class="card">
      <div class="brand"><img src="${iconUrl}" alt="" /> CCA Message AI</div>
      <h1>Mensajes más claros.<br /><span>IA en tu equipo.</span></h1>
      <p class="sub">Corrige y mejora tus borradores en WhatsApp Web con un modelo local.</p>
      <div class="tags"><span>Gratis</span><span>Código abierto</span><span>llama.cpp</span></div>
      <div class="chat"><div class="top">Conversación de ejemplo</div><div class="message">Hola, te confirmo que podré asistir a la reunión de mañana.</div><div class="actions"><span>✓ Corregir</span><span>✨ Mejorar</span></div></div>
    </div>
  `);
  await page.screenshot({ path: "social-card.png" });
  await page.close();
} finally {
  await browser.close();
}
