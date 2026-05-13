import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const petTagRe = /\[(?:text|emotion|action|mbti|memory_type)[^\]]*\]/g

export function stripPetTags(text: string): string {
  return text.replace(petTagRe, "").trim()
}

export function extractPetText(text: string): string {
  const m = text.match(/\[text:([^\]]*)\]/)
  if (m) return m[1]
  return stripPetTags(text)
}
