package modelconfig

func MaskAPIKey(key string) string {
	if key == "" {
		return ""
	}

	if len(key) <= 8 {
		return "****"
	}

	if len(key) <= 12 {
		return key[:3] + "****" + key[len(key)-2:]
	}

	return key[:3] + "****" + key[len(key)-4:]
}
