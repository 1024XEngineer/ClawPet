"use client"

import { Check, Sparkles, Zap, Crown, Star, Heart, Gift, Rocket } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const plans = [
  {
    id: "free",
    name: "免费版",
    nameEn: "Free",
    icon: "🐣",
    price: "0",
    period: "永久免费",
    description: "适合轻度用户，体验基础功能",
    color: "from-slate-400 to-zinc-500",
    features: [
      "每日 20 次对话",
      "基础 AI 技能",
      "加入 3 个频道",
      "社区支持",
    ],
    limitations: [
      "无定时任务",
      "无自定义技能",
    ],
    buttonText: "当前方案",
    buttonVariant: "outline" as const,
    isCurrent: true,
  },
  {
    id: "pro",
    name: "专业版",
    nameEn: "Pro",
    icon: "🐱",
    price: "29",
    period: "/月",
    description: "适合重度用户，解锁更多可能",
    color: "from-orange-400 to-pink-500",
    features: [
      "无限对话次数",
      "全部 AI 技能",
      "无限频道",
      "10 个定时任务",
      "自定义技能",
      "优先响应速度",
      "专属客服支持",
    ],
    limitations: [],
    buttonText: "升级到专业版",
    buttonVariant: "default" as const,
    isPopular: true,
    isCurrent: false,
  },
  {
    id: "team",
    name: "团队版",
    nameEn: "Team",
    icon: "🐾",
    price: "99",
    period: "/月/人",
    description: "适合团队协作，共享资源",
    color: "from-purple-400 to-indigo-500",
    features: [
      "包含专业版全部功能",
      "团队协作空间",
      "无限定时任务",
      "API 接口访问",
      "高级数据分析",
      "团队管理后台",
      "SLA 保障",
      "专属技术支持",
    ],
    limitations: [],
    buttonText: "联系我们",
    buttonVariant: "outline" as const,
    isCurrent: false,
  },
]

const faqs = [
  {
    q: "可以随时取消订阅吗？",
    a: "当然可以！你可以随时取消订阅，取消后仍可使用到当前周期结束。",
  },
  {
    q: "支持哪些支付方式？",
    a: "我们支持微信支付、支付宝、信用卡等多种支付方式。",
  },
  {
    q: "有学生优惠吗？",
    a: "有的！验证学生身份后可享受 5 折优惠，详情请联系客服~",
  },
  {
    q: "团队版最少几人起？",
    a: "团队版最少 3 人起订，人数越多优惠越大哦！",
  },
]

export function PricingPage() {
  return (
    <div className="flex-1 flex flex-col bg-background overflow-auto">
      {/* Header */}
      <header className="text-center px-6 py-8 border-b border-border">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-gradient-to-r from-orange-100 to-pink-100 rounded-full text-sm text-orange-600 mb-4">
          <Gift className="w-4 h-4" />
          限时优惠：年付享 8 折
        </div>
        <h1 className="text-3xl font-bold text-foreground mb-2">
          选择适合你的方案
        </h1>
        <p className="text-muted-foreground">
          无论是个人使用还是团队协作，我们都有合适的方案~
        </p>
      </header>

      <div className="flex-1 p-6">
        {/* Pricing Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto mb-12">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className={cn(
                "relative p-6 rounded-2xl border bg-background transition-all",
                plan.isPopular
                  ? "border-orange-300 shadow-lg shadow-orange-100 scale-105"
                  : "border-border hover:border-orange-200 hover:shadow-md"
              )}
            >
              {/* Popular Badge */}
              {plan.isPopular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-gradient-to-r from-orange-400 to-pink-500 text-white text-xs rounded-full flex items-center gap-1">
                  <Sparkles className="w-3 h-3" />
                  最受欢迎
                </div>
              )}

              {/* Header */}
              <div className="text-center mb-6">
                <div className={cn(
                  "w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br flex items-center justify-center text-3xl mb-3",
                  plan.color
                )}>
                  {plan.icon}
                </div>
                <h3 className="text-xl font-bold text-foreground">{plan.name}</h3>
                <p className="text-xs text-muted-foreground">{plan.nameEn}</p>
              </div>

              {/* Price */}
              <div className="text-center mb-4">
                <div className="flex items-baseline justify-center gap-1">
                  <span className="text-sm text-muted-foreground">¥</span>
                  <span className="text-4xl font-bold text-foreground">{plan.price}</span>
                  <span className="text-sm text-muted-foreground">{plan.period}</span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">{plan.description}</p>
              </div>

              {/* Features */}
              <ul className="space-y-2.5 mb-6">
                {plan.features.map((feature, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <div className="w-4 h-4 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                      <Check className="w-3 h-3 text-green-600" />
                    </div>
                    <span className="text-foreground">{feature}</span>
                  </li>
                ))}
                {plan.limitations.map((limitation, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <div className="w-4 h-4 rounded-full bg-muted flex items-center justify-center shrink-0">
                      <span className="text-xs">-</span>
                    </div>
                    <span>{limitation}</span>
                  </li>
                ))}
              </ul>

              {/* CTA Button */}
              <Button
                variant={plan.buttonVariant}
                className={cn(
                  "w-full",
                  plan.isPopular && "bg-gradient-to-r from-orange-400 to-pink-500 hover:from-orange-500 hover:to-pink-600 text-white border-0",
                  plan.isCurrent && "pointer-events-none opacity-50"
                )}
              >
                {plan.buttonText}
              </Button>
            </div>
          ))}
        </div>

        {/* FAQ Section */}
        <div className="max-w-2xl mx-auto">
          <h2 className="text-xl font-bold text-foreground text-center mb-6">
            常见问题
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {faqs.map((faq, i) => (
              <div key={i} className="p-4 rounded-xl border border-border bg-muted/30">
                <p className="font-medium text-foreground mb-1">{faq.q}</p>
                <p className="text-sm text-muted-foreground">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="text-center mt-10 mb-6">
          <div className="inline-flex items-center gap-3 px-6 py-3 bg-gradient-to-r from-orange-50 to-pink-50 rounded-2xl border border-orange-100">
            <span className="text-2xl">🐾</span>
            <div className="text-left">
              <p className="font-medium text-foreground">还有疑问？</p>
              <p className="text-sm text-muted-foreground">随时联系我们的客服小姐姐~</p>
            </div>
            <Button variant="outline" size="sm" className="ml-4 text-orange-500 border-orange-300 hover:bg-orange-50">
              <Heart className="w-4 h-4 mr-1" />
              联系客服
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
