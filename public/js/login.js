// CineVerse Login Page Logic
document.addEventListener('DOMContentLoaded', () => {
    // Check if already logged in
    if (authService.isAuthenticated()) {
        window.location.href = 'home.html';
        return;
    }

    // Get DOM elements
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const showRegisterLink = document.getElementById('showRegister');
    const showLoginLink = document.getElementById('showLogin');
    const preferencesModal = document.getElementById('preferencesModal');
    const preferencesForm = document.getElementById('preferencesForm');
    const googleLoginBtn = document.getElementById('googleLogin');
    const googleSignupBtn = document.getElementById('googleSignup');
    const guestLoginBtn = document.getElementById('guestLogin');

    let pendingUser = null;

    // Toggle between login and register forms
    showRegisterLink.addEventListener('click', (e) => {
        e.preventDefault();
        loginForm.classList.remove('active');
        registerForm.classList.add('active');
        clearErrors();
    });

    showLoginLink.addEventListener('click', (e) => {
        e.preventDefault();
        registerForm.classList.remove('active');
        loginForm.classList.add('active');
        clearErrors();
    });

    // Google Login (placeholder)
    googleLoginBtn.addEventListener('click', (e) => {
        e.preventDefault();
        showToast('Google Sign-In coming soon!', 'error');
    });

    googleSignupBtn.addEventListener('click', (e) => {
        e.preventDefault();
        showToast('Google Sign-Up coming soon!', 'error');
    });

    guestLoginBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const result = authService.loginAsGuest();
        if (!result.success) {
            showToast('Guest login failed', 'error');
            return;
        }

        showToast('Entering as guest...', 'success');
        setTimeout(() => {
            window.location.href = 'home.html';
        }, 700);
    });

    // Handle login form submission
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearErrors();

        const identifier = document.getElementById('loginIdentifier').value.trim();
        const password = document.getElementById('loginPassword').value;

        // Validation
        if (!identifier) {
            showError('loginIdentifierError', 'Email or username is required');
            return;
        }

        if (!password) {
            showError('loginPasswordError', 'Password is required');
            return;
        }

        // Attempt login
        const result = await authService.login(identifier, password);

        if (result.success) {
            showToast('Login successful! Redirecting...', 'success');
            // Redirect after short delay
            setTimeout(() => {
                window.location.href = 'home.html';
            }, 1000);
        } else {
            showToast(result.error, 'error');
        }
    });

    // Handle register form submission
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearErrors();

        const username = document.getElementById('registerUsername').value.trim();
        const email = document.getElementById('registerEmail').value.trim();
        const password = document.getElementById('registerPassword').value;
        const confirmPassword = document.getElementById('registerConfirmPassword').value;

        // Validation
        let hasError = false;

        if (!username || username.length < 3) {
            showError('registerUsernameError', 'Username must be at least 3 characters');
            hasError = true;
        }

        if (!email || !authService.validateEmail(email)) {
            showError('registerEmailError', 'Please enter a valid email address');
            hasError = true;
        }

        if (!password || password.length < 8) {
            showError('registerPasswordError', 'Password must be at least 8 characters');
            hasError = true;
        }

        if (password !== confirmPassword) {
            showError('registerConfirmPasswordError', 'Passwords do not match');
            hasError = true;
        }

        if (hasError) return;

        // Attempt registration
        const result = await authService.register(username, email, password);

        if (result.success) {
            pendingUser = result.user;
            showToast('Account created successfully!', 'success');
            setTimeout(() => {
                preferencesModal.classList.add('active');
            }, 800);
        } else {
            showToast(result.error, 'error');
        }
    });

    // Handle preferences form submission
    preferencesForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (!pendingUser) {
            showToast('Session expired. Please register again.', 'error');
            preferencesModal.classList.remove('active');
            return;
        }

        // Get selected languages
        const languageCheckboxes = document.querySelectorAll('input[name="language"]:checked');
        const languages = Array.from(languageCheckboxes).map(cb => cb.value);

        // Get selected genres
        const genreCheckboxes = document.querySelectorAll('input[name="genre"]:checked');
        const genres = Array.from(genreCheckboxes).map(cb => parseInt(cb.value));

        // Smart onboarding quiz for cold-start recommendations
        const quiz = await runSmartOnboardingQuiz();

        // Save preferences
        const preferences = { languages, genres, quiz };
        const saved = storageManager.savePreferences(pendingUser.id, preferences);

        if (!saved) {
            showToast('Failed to save preferences. Please try again.', 'error');
            return;
        }

        // Create session
        authService.createSession(pendingUser);
        showToast('Welcome to CineMatch!', 'success');
        
        // Redirect to home
        setTimeout(() => {
            window.location.href = 'home.html';
        }, 1000);
    });

    async function runSmartOnboardingQuiz() {
        // Using prompt-based micro-quiz to avoid layout/CSS modifications.
        const mood = (prompt('Quick setup: Choose mood (Feel-good, Mind-bending, Dark, Family, Epic):', 'Feel-good') || 'Feel-good').trim();
        const runtimeChoice = (prompt('Preferred runtime? (short, medium, long):', 'medium') || 'medium').trim().toLowerCase();
        const platform = (prompt('Preferred platform? (Netflix, Prime Video, Disney+ Hotstar):', 'Netflix') || 'Netflix').trim();
        const maturity = (prompt('Comfort maturity? (U/A 7+, U/A 13+, U/A 16+):', 'U/A 13+') || 'U/A 13+').trim();
        const subtitle = (prompt('Subtitle language code? (en, hi, ta, te, es):', 'en') || 'en').trim().toLowerCase();
        const dubbing = (prompt('Dubbing language code? (en, hi, ta, te):', 'en') || 'en').trim().toLowerCase();

        return {
            mood,
            runtimeBand: ['short', 'medium', 'long'].includes(runtimeChoice) ? runtimeChoice : 'medium',
            platform,
            maturity,
            subtitle,
            dubbing
        };
    }

    // Utility functions
    function showError(elementId, message) {
        const errorElement = document.getElementById(elementId);
        if (errorElement) {
            errorElement.textContent = message;
        }
    }

    function clearErrors() {
        const errorElements = document.querySelectorAll('.error-msg');
        errorElements.forEach(el => el.textContent = '');
    }

    function showToast(message, type = 'success') {
        const toast = document.getElementById('toast');
        const toastMessage = toast.querySelector('.toast-message');
        const toastIcon = toast.querySelector('.toast-icon');
        
        if (toastMessage) {
            toastMessage.textContent = message;
        }
        
        if (type === 'error' && toastIcon) {
            toastIcon.innerHTML = '<path d="M18 6L6 18M6 6L18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
        } else if (toastIcon) {
            toastIcon.innerHTML = '<path d="M9 11L12 14L22 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
        }
        
        toast.className = `toast ${type} show`;
        
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }
});
