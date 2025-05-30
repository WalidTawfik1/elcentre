import { apiRequest } from "./api";
import { LoginDTO, RegisterDTO, UserDTO } from "@/types/api";
import { DIRECT_API_URL } from "@/config/api-config";

// Helper function to set a cookie with expiration
const setCookie = (name: string, value: string, days = 7) => {
  const date = new Date();
  date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
  const expires = "; expires=" + date.toUTCString();
  document.cookie = name + "=" + value + expires + "; path=/; SameSite=Lax";
};

// Helper function to get a cookie value
const getCookie = (name: string): string | null => {
  const nameEQ = name + "=";
  const ca = document.cookie.split(';');
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) === ' ') c = c.substring(1, c.length);
    if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
  }
  return null;
};

// Direct API fetch function for auth operations
const directApiRequest = async <T>(endpoint: string, options: RequestInit = {}, requiresAuth = false): Promise<T> => {
  // Construct the full URL with the direct API URL
  const url = `${DIRECT_API_URL}${endpoint}`;
  
  // Set default headers
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };

  // Add authorization header if required and token exists
  if (requiresAuth) {
    const token = getCookie('jwt');
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  }

  // Merge provided options with defaults
  const requestOptions: RequestInit = {
    ...options,
    headers: {
      ...headers,
      ...(options.headers || {})
    },
    credentials: 'include', // Always include credentials for auth operations
    mode: 'cors'
  };

  try {
    console.log('Direct API request options:', JSON.stringify({
      url,
      method: requestOptions.method || 'GET',
      hasAuthHeader: !!headers["Authorization"]?.length,
      credentials: requestOptions.credentials,
      mode: requestOptions.mode
    }));
    
    const response = await fetch(url, requestOptions);
    
    // Extract JWT token from response headers if available
    const authHeader = response.headers.get('Authorization') || response.headers.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const tokenFromHeader = authHeader.substring(7);
      setCookie('jwt', tokenFromHeader, 7);
    }
    
    if (!response.ok) {
      // Try to parse error response
      try {
        const errorData = await response.json();
        console.error('Auth API error:', errorData);
        
        // Handle specific error cases
        if (response.status === 400) {
          // Check for unverified account error
          if (errorData.message?.toLowerCase().includes('not verified') || 
              errorData.message?.toLowerCase().includes('verify') ||
              errorData.errorCode === 'ACCOUNT_NOT_VERIFIED') {
            const error = new Error(errorData.message || 'Account not verified');
            error.name = 'Account not verified';
            throw error;
          }
        }
        if (response.status === 400) {
          // Check for unverified account error
          if (errorData.message?.toLowerCase().includes('invalid')) {
            const error = new Error(errorData.message || 'Invalid Email or Password');
            error.name = 'Invalid Email or Password';
            throw error;
          }
        }

        if (response.status === 400) {
          // Check for unverified account error
          if (errorData.message?.toLowerCase().includes('must')) {
            const error = new Error(errorData.message || 'Create a strong password');
            error.name = 'Create a strong password';
            throw error;
          }
        }
        
        throw new Error(errorData.message || `API Error: ${response.status}`);
      } catch (e) {
        if (e.name === 'Account not verified' || e.name === 'Invalid Email or Password' || e.name === 'Create a strong password') {
          throw e;
        }
        throw new Error(`API Error: ${response.status} - ${response.statusText}`);
      }
    }
    
    // For 204 No Content responses
    if (response.status === 204) {
      return {} as T;
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("API request failed:", error);
    throw error;
  }
};

export const AuthService = {
  login: async (credentials: LoginDTO): Promise<any> => {
    try {
      // Use direct API connection for login to ensure cookies are set properly
      const response = await directApiRequest<any>("/Account/login", {
        method: "POST",
        body: JSON.stringify(credentials)
      }, false);
      
      // Check for token in response and manually set it as a cookie if needed
      if (response) {
        // Try to extract token from multiple possible locations in the response
        let token = null;
        
        // Check common locations where the token might be
        if (typeof response === 'string') {
          // Sometimes backend returns the token directly as a string
          token = response;
        } else {
          // Look in various possible properties
          token = response.message || 
                  response.token || 
                  response.accessToken || 
                  response.jwt ||
                  response.access_token ||
                  (response.data && (
                    response.data.token || 
                    response.data.accessToken ||
                    response.data.jwt
                  ));
        }
        
        if (token) {
          // Remove any existing token cookie that might be present
          document.cookie = "jwt=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
          document.cookie = "token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
          // Set the JWT as a cookie that expires in 7 days
          setCookie('jwt', token, 7);
        } else {
          console.warn("No JWT token found in login response");
        }
      }
      
      // Debug cookie
      setTimeout(() => {
        console.log("Checking for JWT cookie after login:", 
          document.cookie.includes('jwt=') ? "Found" : "Not found",
          "Cookie value:", getCookie('jwt')?.substring(0, 10) + "...");
      }, 300);
      
      return response;
    } catch (error) {
      // Handle account not verified error
      if (error.name === 'ACCOUNT_NOT_VERIFIED') {
        // Store the email in sessionStorage so the verification page can use it
        if (credentials.email) {
          sessionStorage.setItem('unverifiedEmail', credentials.email);
        }
        
        // Redirect to verification page
        window.location.href = '/verify-account';
        
        // Return a clear error for handling in the UI
        return Promise.reject({
          isUnverified: true,
          message: error.message || 'Account not verified. Please verify your account.'
        });
      }
      
      // Re-throw other errors
      return Promise.reject(error);
    }
  },
  
  register: async (userData: RegisterDTO): Promise<any> => {
    // Use direct API connection for registration
    return directApiRequest<any>("/Account/register", {
      method: "POST",
      body: JSON.stringify(userData)
    }, false);
  },
  
  activeAccount: async (email: string, code: string): Promise<any> => {
    return apiRequest<any>("/Account/active-account", {
      method: "POST",
      body: JSON.stringify({ email, code }),
    }, false);
  },
  
  logout: async (): Promise<any> => {
    const response = await apiRequest<any>("/Account/logout", {
      method: "POST",
      credentials: "include"
    }, true);
    
    // Clear client-side auth state if needed
    return response;
  },
  
  getProfile: async (): Promise<UserDTO> => {
    // Debug JWT cookie presence
    console.log("JWT cookie present before profile fetch:", 
      document.cookie.includes('jwt='));
    
    return apiRequest<UserDTO>("/Account/profile", {
      credentials: "include" // Explicitly include credentials
    }, true);
  },
  
  updateProfile: async (userData: UserDTO): Promise<any> => {
    return apiRequest<any>("/Account/edit-profile", {
      method: "PUT",
      body: JSON.stringify(userData),
      credentials: "include"
    }, true);
  },
  
  verifyOTP: async (email: string, code: string): Promise<any> => {
    return apiRequest<any>("/Account/verify-otp", {
      method: "POST",
      body: JSON.stringify({ email, code }),
    }, false);
  },
  
  resendOTP: async (email: string): Promise<any> => {
    return apiRequest<any>("/Account/resend-otp", {
      method: "POST",
      body: JSON.stringify({ email }),
    }, false);
  },
  
  requestPasswordReset: async (email: string): Promise<any> => {
    return apiRequest<any>(`/Account/send-email-forget-password?email=${encodeURIComponent(email)}`);
  },
  
  resetPassword: async (email: string, password: string, code: string): Promise<any> => {
    return apiRequest<any>("/Account/reset-password", {
      method: "POST",
      body: JSON.stringify({ email, password, code }),
    }, false);
  },
  
  // Helper method to check if JWT cookie is present
  hasAuthCookie: (): boolean => {
    return document.cookie.includes('jwt=');
  },
  
  // Get the JWT token from cookie
  getAuthToken: (): string | null => {
    return getCookie('jwt');
  }
};
