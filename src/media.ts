/**
 * 微信 CDN 媒体下载 + AES-128-ECB 解密 + SILK 语音转 WAV。
 *
 * 关键点：微信 CDN 的图片/语音链接会过期，必须在收到消息时立刻下载。
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { getConfig } from "./config.ts";
import { MessageItemType, type MessageItem } from "./ilink.ts";

function cdnBase(): string {
  return getConfig().ilink.cdnBaseUrl;
}

function downloadUrl(encryptParam: string): string {
  const base = cdnBase().endsWith("/") ? cdnBase().slice(0, -1) : cdnBase();
  return `${base}/download?encrypted_query_param=${encodeURIComponent(encryptParam)}`;
}

export function decryptAesEcb(ciphertext: Buffer, key: Buffer): Buffer {
  const d = crypto.createDecipheriv("aes-128-ecb", key, null);
  return Buffer.concat([d.update(ciphertext), d.final()]);
}

/**
 * aes_key 有两种编码：base64(16 字节原始 key) 或 base64(32 位 hex 字符串)。
 */
function parseAesKey(aesKeyBase64: string): Buffer {
  const decoded = Buffer.from(aesKeyBase64, "base64");
  if (decoded.length === 16) return decoded;
  const ascii = decoded.toString("ascii");
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(ascii)) {
    return Buffer.from(ascii, "hex");
  }
  throw new Error(`aes_key 长度异常: ${decoded.length}`);
}

async function fetchCdn(encryptParam: string): Promise<Buffer> {
  const res = await fetch(downloadUrl(encryptParam));
  if (!res.ok) throw new Error(`CDN 下载失败 HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function downloadDecrypt(encryptParam: string, aesKeyBase64: string): Promise<Buffer> {
  const key = parseAesKey(aesKeyBase64);
  return decryptAesEcb(await fetchCdn(encryptParam), key);
}

export async function downloadPlain(encryptParam: string): Promise<Buffer> {
  return fetchCdn(encryptParam);
}

/** SILK → WAV；silk-wasm 不可用时返回 null（保留 .silk 原文件） */
async function silkToWav(silk: Buffer): Promise<Buffer | null> {
  try {
    const { decode } = await import("silk-wasm");
    const { data: pcm } = await decode(silk, 24_000);
    const pcmBuf = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + pcmBuf.length, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(1, 22); // mono
    header.writeUInt32LE(24_000, 24);
    header.writeUInt32LE(48_000, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36);
    header.writeUInt32LE(pcmBuf.length, 40);
    return Buffer.concat([header, pcmBuf]);
  } catch {
    return null;
  }
}

export type DownloadedMedia = {
  filename: string;
  buffer: Buffer;
  kind: "image" | "voice" | "file" | "video";
  /** 语音的微信转写文字 */
  transcript?: string;
};

function extFromName(name: string | undefined, fallback: string): string {
  if (!name) return fallback;
  const e = path.extname(name);
  return e && e.length <= 8 ? e : fallback;
}

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 120) || "untitled";
}

/**
 * 下载一条消息里的媒体。一条消息可能同时含多个 item，这里全部取出。
 */
export async function downloadAllMedia(itemList: MessageItem[] | undefined, stamp: string): Promise<DownloadedMedia[]> {
  if (!itemList?.length) return [];
  const out: DownloadedMedia[] = [];

  for (const item of itemList) {
    try {
      if (item.type === MessageItemType.IMAGE && item.image_item?.media?.encrypt_query_param) {
        const img = item.image_item;
        const key = img.aeskey ? Buffer.from(img.aeskey, "hex").toString("base64") : img.media.aes_key;
        const buf = key
          ? await downloadDecrypt(img.media.encrypt_query_param, key)
          : await downloadPlain(img.media.encrypt_query_param);
        out.push({ filename: `${stamp}-${out.length + 1}.jpg`, buffer: buf, kind: "image" });
        continue;
      }

      if (item.type === MessageItemType.VOICE && item.voice_item) {
        const v = item.voice_item;
        const transcript = v.text;
        if (v.media?.encrypt_query_param && v.media.aes_key) {
          const silk = await downloadDecrypt(v.media.encrypt_query_param, v.media.aes_key);
          const wav = await silkToWav(silk);
          if (wav) {
            out.push({ filename: `${stamp}-${out.length + 1}.wav`, buffer: wav, kind: "voice", transcript });
          } else {
            out.push({ filename: `${stamp}-${out.length + 1}.silk`, buffer: silk, kind: "voice", transcript });
          }
        } else if (transcript) {
          // 没有媒体只有转写文字，交由上层当文本处理
          out.push({ filename: "", buffer: Buffer.alloc(0), kind: "voice", transcript });
        }
        continue;
      }

      if (item.type === MessageItemType.FILE && item.file_item?.media?.encrypt_query_param) {
        const f = item.file_item;
        const key = f.media.aes_key;
        const buf = key
          ? await downloadDecrypt(f.media.encrypt_query_param, key)
          : await downloadPlain(f.media.encrypt_query_param);
        const name = safeName(f.file_name ?? `${stamp}-${out.length + 1}.bin`);
        out.push({ filename: name, buffer: buf, kind: "file" });
        continue;
      }

      if (item.type === MessageItemType.VIDEO && item.video_item?.media?.encrypt_query_param) {
        const v = item.video_item;
        const key = v.media.aes_key;
        const buf = key
          ? await downloadDecrypt(v.media.encrypt_query_param, key)
          : await downloadPlain(v.media.encrypt_query_param);
        out.push({ filename: `${stamp}-${out.length + 1}.mp4`, buffer: buf, kind: "video" });
      }
    } catch (err) {
      // 单个媒体失败不拖垮整条消息
      console.error("[media] 下载失败:", err instanceof Error ? err.message : err);
    }
  }

  return out;
}

export async function writeFileDeep(dir: string, filename: string, buf: Buffer): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const p = path.join(dir, filename);
  await fs.writeFile(p, buf);
  return p;
}

export { extFromName, safeName };
