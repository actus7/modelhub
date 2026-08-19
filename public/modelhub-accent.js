(function () {
  try {
    var accent = localStorage.getItem("modelhub-accent")
    var allowed = ["blue", "violet", "emerald", "orange", "rose", "teal"]
    if (accent && allowed.indexOf(accent) !== -1) {
      document.documentElement.setAttribute("data-accent", accent)
    }
  } catch {
    // Local storage can be unavailable in privacy-restricted contexts.
  }
})()
