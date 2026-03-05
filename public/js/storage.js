// Storage Manager - Handles all localStorage operations
class StorageManager {
    constructor() {
        this.storageAvailable = this.checkStorageAvailability();
        if (!this.storageAvailable) {
            console.error('localStorage is not available');
        }
    }

    checkStorageAvailability() {
        try {
            const test = '__storage_test__';
            localStorage.setItem(test, test);
            localStorage.removeItem(test);
            return true;
        } catch (e) {
            return false;
        }
    }

    // User Management
    saveUser(user) {
        if (!this.storageAvailable) return false;
        try {
            const users = this.getAllUsers();
            users[user.id] = user;
            localStorage.setItem('users', JSON.stringify(users));
            return true;
        } catch (e) {
            console.error('Error saving user:', e);
            return false;
        }
    }

    getUser(identifier) {
        if (!this.storageAvailable) return null;
        try {
            const users = this.getAllUsers();
            return Object.values(users).find(
                user => user.username === identifier || user.email === identifier
            );
        } catch (e) {
            console.error('Error getting user:', e);
            return null;
        }
    }

    getUserById(userId) {
        if (!this.storageAvailable) return null;
        try {
            const users = this.getAllUsers();
            return users[userId] || null;
        } catch (e) {
            console.error('Error getting user by ID:', e);
            return null;
        }
    }

    getAllUsers() {
        if (!this.storageAvailable) return {};
        try {
            const users = localStorage.getItem('users');
            return users ? JSON.parse(users) : {};
        } catch (e) {
            console.error('Error getting all users:', e);
            return {};
        }
    }

    // Preferences Management
    savePreferences(userId, preferences) {
        if (!this.storageAvailable) return false;
        try {
            const user = this.getUserById(userId);
            if (!user) return false;
            
            user.preferences = preferences;
            return this.saveUser(user);
        } catch (e) {
            console.error('Error saving preferences:', e);
            return false;
        }
    }

    getPreferences(userId) {
        if (!this.storageAvailable) return null;
        try {
            const user = this.getUserById(userId);
            return user ? user.preferences : null;
        } catch (e) {
            console.error('Error getting preferences:', e);
            return null;
        }
    }

    // Rating Management
    saveRating(userId, movieId, rating) {
        if (!this.storageAvailable) return false;
        try {
            const ratings = this.getAllRatings();
            if (!ratings[userId]) {
                ratings[userId] = {};
            }
            ratings[userId][movieId] = {
                userId,
                movieId,
                rating,
                timestamp: Date.now()
            };
            localStorage.setItem('ratings', JSON.stringify(ratings));
            return true;
        } catch (e) {
            console.error('Error saving rating:', e);
            return false;
        }
    }

    getRating(userId, movieId) {
        if (!this.storageAvailable) return null;
        try {
            const ratings = this.getAllRatings();
            return ratings[userId] && ratings[userId][movieId] ? ratings[userId][movieId] : null;
        } catch (e) {
            console.error('Error getting rating:', e);
            return null;
        }
    }

    getUserRatings(userId) {
        if (!this.storageAvailable) return {};
        try {
            const ratings = this.getAllRatings();
            return ratings[userId] || {};
        } catch (e) {
            console.error('Error getting user ratings:', e);
            return {};
        }
    }

    getAllRatings() {
        if (!this.storageAvailable) return {};
        try {
            const ratings = localStorage.getItem('ratings');
            return ratings ? JSON.parse(ratings) : {};
        } catch (e) {
            console.error('Error getting all ratings:', e);
            return {};
        }
    }

    // Review Management
    saveReview(userId, movieId, reviewText) {
        if (!this.storageAvailable) return false;
        try {
            const reviews = this.getAllReviews();
            if (!reviews[movieId]) {
                reviews[movieId] = [];
            }
            
            const existingReviewIndex = reviews[movieId].findIndex(r => r.userId === userId);
            const user = this.getUserById(userId);
            
            const review = {
                id: existingReviewIndex >= 0 ? reviews[movieId][existingReviewIndex].id : this.generateId(),
                userId,
                movieId,
                username: user ? user.username : 'Anonymous',
                reviewText,
                timestamp: Date.now()
            };

            if (existingReviewIndex >= 0) {
                reviews[movieId][existingReviewIndex] = review;
            } else {
                reviews[movieId].push(review);
            }

            localStorage.setItem('reviews', JSON.stringify(reviews));
            return true;
        } catch (e) {
            console.error('Error saving review:', e);
            return false;
        }
    }

    getReview(userId, movieId) {
        if (!this.storageAvailable) return null;
        try {
            const reviews = this.getMovieReviews(movieId);
            return reviews.find(r => r.userId === userId) || null;
        } catch (e) {
            console.error('Error getting review:', e);
            return null;
        }
    }

    getMovieReviews(movieId) {
        if (!this.storageAvailable) return [];
        try {
            const reviews = this.getAllReviews();
            return reviews[movieId] || [];
        } catch (e) {
            console.error('Error getting movie reviews:', e);
            return [];
        }
    }

    getAllReviews() {
        if (!this.storageAvailable) return {};
        try {
            const reviews = localStorage.getItem('reviews');
            return reviews ? JSON.parse(reviews) : {};
        } catch (e) {
            console.error('Error getting all reviews:', e);
            return {};
        }
    }

    // Watchlist Management
    addToWatchlist(userId, movieId) {
        if (!this.storageAvailable) return false;
        try {
            const watchlists = this.getAllWatchlists();
            if (!watchlists[userId]) {
                watchlists[userId] = [];
            }
            if (!watchlists[userId].includes(movieId)) {
                watchlists[userId].push(movieId);
                localStorage.setItem('watchlists', JSON.stringify(watchlists));
            }
            return true;
        } catch (e) {
            console.error('Error adding to watchlist:', e);
            return false;
        }
    }

    removeFromWatchlist(userId, movieId) {
        if (!this.storageAvailable) return false;
        try {
            const watchlists = this.getAllWatchlists();
            if (watchlists[userId]) {
                watchlists[userId] = watchlists[userId].filter(id => id !== movieId);
                localStorage.setItem('watchlists', JSON.stringify(watchlists));
            }
            return true;
        } catch (e) {
            console.error('Error removing from watchlist:', e);
            return false;
        }
    }

    getWatchlist(userId) {
        if (!this.storageAvailable) return [];
        try {
            const watchlists = this.getAllWatchlists();
            return watchlists[userId] || [];
        } catch (e) {
            console.error('Error getting watchlist:', e);
            return [];
        }
    }

    isInWatchlist(userId, movieId) {
        if (!this.storageAvailable) return false;
        try {
            const watchlist = this.getWatchlist(userId);
            return watchlist.includes(movieId);
        } catch (e) {
            console.error('Error checking watchlist:', e);
            return false;
        }
    }

    getAllWatchlists() {
        if (!this.storageAvailable) return {};
        try {
            const watchlists = localStorage.getItem('watchlists');
            return watchlists ? JSON.parse(watchlists) : {};
        } catch (e) {
            console.error('Error getting all watchlists:', e);
            return {};
        }
    }

    // Utility Methods
    generateId() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    clearAllData() {
        if (!this.storageAvailable) return false;
        try {
            localStorage.removeItem('users');
            localStorage.removeItem('ratings');
            localStorage.removeItem('reviews');
            localStorage.removeItem('watchlists');
            sessionStorage.removeItem('currentSession');
            return true;
        } catch (e) {
            console.error('Error clearing data:', e);
            return false;
        }
    }
}

// Create global instance
const storageManager = new StorageManager();
