package providers

const (
	CodeProviderLLM       = "provider_llm"
	CodeProviderRateLimit = "provider_rate_limit"
	CodeProviderTimeout   = "provider_timeout"
	CodeProviderOverload  = "provider_overload"
	CodeProviderAuth      = "provider_auth"
	CodeProviderFormat    = "provider_format"
	CodeProviderContext   = "provider_context"
	CodeProviderUnknown   = "provider_unknown"
	CodeProviderAPI       = "provider_api"
)

const (
	ReasonRateLimit       = "rate_limit"
	ReasonOverloaded      = "overloaded"
	ReasonTimeout         = "timeout"
	ReasonContextOverflow = "context_overflow"
	ReasonAuth            = "auth"
	ReasonFormat          = "format"
	ReasonUnknown         = "unknown"
	ReasonAPI             = "api"
)
