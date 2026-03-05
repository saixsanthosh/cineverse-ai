// Authentication Service - Handles user authentication and session management
class AuthenticationService {
    constructor(storageManager) {
        this.storage = storageManager;
    }

    async hashPassword(password) {
        // Simple hash for demo purposes - in production, use proper backend authentication
        const encoder = new TextEncoder();
        const data = encoder.encode(password);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async register(username, email, password) {
        // Validation
        if (!username || username.length < 3) {
            return { success: false, error: 'Username must be at least 3 characters' };
        }

        if (!email || !this.validateEmail(email)) {
            return { success: false, error: 'Invalid email address' };
        }

        if (!password || password.length < 8) {
            return { success: false, error: 'Password must be at least 8 characters' };
        }

        // Check if user already exists
        const existingUser = this.storage.getUser(username) || this.storage.getUser(email);
        if (existingUser) {
            return { success: false, error: 'Username or email already exists' };
        }

        // Create new user
        const passwordHash = await this.hashPassword(password);
        const user = {
            id: this.storage.generateId(),
            username,
            email,
            passwordHash,
            createdAt: Date.now(),
            preferences: {
                languages: [],
                genres: []
            }
        };

        const saved = this.storage.saveUser(user);
        if (!saved) {
            return { success: false, error: 'Failed to save user' };
        }

        return { success: true, user };
    }

    async login(identifier, password) {
        // Validation
        if (!identifier || !password) {
            return { success: false, error: 'Username/email and password are required' };
        }

        // Find user
        const user = this.storage.getUser(identifier);
        if (!user) {
            return { success: false, error: 'Invalid credentials' };
        }

        // Verify password
        const passwordHash = await this.hashPassword(password);
        if (passwordHash !== user.passwordHash) {
            return { success: false, error: 'Invalid credentials' };
        }

        // Create session
        this.createSession(user);

        return { success: true, user };
    }

    logout() {
        this.destroySession();
        return { success: true };
    }

    loginAsGuest() {
        const guestUser = this.createGuestUser();
        this.createSession(guestUser);
        return { success: true, user: guestUser };
    }

    createGuestUser() {
        return {
            id: 'guest',
            username: 'Guest',
            email: 'guest@cinematch.local',
            isGuest: true,
            createdAt: Date.now(),
            preferences: {
                languages: [],
                genres: []
            }
        };
    }

    createSession(user) {
        const session = {
            userId: user.id,
            loginTime: Date.now(),
            isGuest: !!user.isGuest,
            guestUser: user.isGuest ? user : null
        };
        sessionStorage.setItem('currentSession', JSON.stringify(session));
    }

    destroySession() {
        sessionStorage.removeItem('currentSession');
    }

    getCurrentUser() {
        const sessionData = sessionStorage.getItem('currentSession');
        if (!sessionData) return null;

        try {
            const session = JSON.parse(sessionData);
            if (session.isGuest && session.guestUser) {
                return session.guestUser;
            }
            return this.storage.getUserById(session.userId);
        } catch (e) {
            console.error('Error getting current user:', e);
            return null;
        }
    }

    isAuthenticated() {
        return this.getCurrentUser() !== null;
    }

    validateEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    validateCredentials(identifier, password) {
        if (!identifier || !password) {
            return { valid: false, error: 'Username/email and password are required' };
        }
        return { valid: true };
    }
}

// Create global instance
const authService = new AuthenticationService(storageManager);
