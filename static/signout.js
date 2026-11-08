(async () => {
    // The sign-out control blocks when there are unsynced sets to avoid data loss.
    for (const key of Object.keys(localStorage)) if (key.startsWith('irontrack-')) localStorage.removeItem(key);
    for (const key of Object.keys(sessionStorage)) if (key.startsWith('irontrack-')) sessionStorage.removeItem(key);
    if ('caches' in window) {
        await Promise.all((await caches.keys()).filter(key => key.startsWith('irontrack-')).map(key => caches.delete(key)));
    }
    if ('serviceWorker' in navigator) {
        await Promise.all((await navigator.serviceWorker.getRegistrations()).map(registration => registration.unregister()));
    }
    location.replace('/login');
})();
