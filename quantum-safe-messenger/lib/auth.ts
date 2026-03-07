// ── Client-side Auth Utilities ──────────────────────────────────
// Tokens stored in memory only — NEVER localStorage or cookies.
// Memory storage means tokens are wiped on page refresh (by design).
// For persistence across refreshes, we use the /api/auth/refresh endpoint.

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

// In-memory token store — never persisted to disk/localStorage
let accessToken: string | null = null
let currentUser: User | null = null

export interface User {
  id: string
  username: string
  email: string
  status?: string
  reliableDelivery?: boolean
  createdAt?: string
}

export interface AuthResult {
  success: boolean
  user?: User
  error?: string
}

// ── Token management ────────────────────────────────────────────
export function setAccessToken(token: string) {
  accessToken = token
}

export function getAccessToken(): string | null {
  return accessToken
}

export function clearTokens() {
  accessToken = null
  currentUser = null
}

export function setCurrentUser(user: User) {
  currentUser = user
}

export function getCurrentUser(): User | null {
  return currentUser
}

export function isAuthenticated(): boolean {
  return accessToken !== null && currentUser !== null
}

// ── API request helper with auth header ─────────────────────────
export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  }

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers,
  })

  const data = await response.json()

  if (!response.ok) {
    throw { status: response.status, message: data.error || 'Request failed' }
  }

  return data
}

// ── Register ────────────────────────────────────────────────────
export async function register(
  username: string,
  email: string,
  password: string
): Promise<AuthResult> {
  try {
    const data = await apiRequest<{ success: boolean; user: User; accessToken: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    })

    setAccessToken(data.accessToken)
    setCurrentUser(data.user)
    return { success: true, user: data.user }
  } catch (err: any) {
    return { success: false, error: err.message || 'Registration failed' }
  }
}

// ── Login ───────────────────────────────────────────────────────
export async function login(
  usernameOrEmail: string,
  password: string
): Promise<AuthResult> {
  try {
    const data = await apiRequest<{ success: boolean; user: User; accessToken: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ usernameOrEmail, password }),
    })

    setAccessToken(data.accessToken)
    setCurrentUser(data.user)
    return { success: true, user: data.user }
  } catch (err: any) {
    return { success: false, error: err.message || 'Login failed' }
  }
}

// ── Logout ──────────────────────────────────────────────────────
export async function logout(): Promise<void> {
  try {
    if (accessToken) {
      await apiRequest('/api/auth/logout', { method: 'POST' })
    }
  } catch (_) {
    // Always clear local state even if server request fails
  } finally {
    clearTokens()
  }
}

// ── Fetch current user ──────────────────────────────────────────
export async function fetchMe(): Promise<User | null> {
  try {
    const data = await apiRequest<{ success: boolean; user: User }>('/api/user/me')
    setCurrentUser(data.user)
    return data.user
  } catch (_) {
    clearTokens()
    return null
  }
}
