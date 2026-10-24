// Avatars made in the browser with DiceBear. Notionists and Shapes are CC0, so no attribution needed.
import { createAvatar } from "@dicebear/core";
import * as notionists from "@dicebear/notionists";
import * as shapes from "@dicebear/shapes";

const cache = new Map();

export function personAvatar(seed, bg = "F3D5D8") {
  const key = `p:${seed}:${bg}`;
  if (!cache.has(key)) cache.set(key, createAvatar(notionists, { seed, backgroundColor: [bg], radius: 50 }).toDataUri());
  return cache.get(key);
}

export function sellerAvatar(seed) {
  const key = `s:${seed}`;
  if (!cache.has(key)) {
    cache.set(key, createAvatar(shapes, {
      seed, radius: 50,
      backgroundColor: ["F0EEE4", "DCEBEF", "F3D5D8", "DFE2F1"],
      shape1Color: ["FF5C34", "3073B7", "5A6499"],
      shape2Color: ["FCF951", "C0DB3A", "CF6977"],
      shape3Color: ["351E28", "EB3C27", "98BFCA"],
    }).toDataUri());
  }
  return cache.get(key);
}