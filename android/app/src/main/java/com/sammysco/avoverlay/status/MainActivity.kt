package com.sammysco.avoverlay.status

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Shows the AV Overlay's own status page (http://<tv>:41101/status) in a full-screen WebView, so the app always
 * matches the page: every row and every button, in portrait and landscape. The TV address is asked for once and
 * can be changed from the menu; the setup page is one menu item away.
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private lateinit var errorBox: LinearLayout
    private lateinit var errorText: TextView
    private lateinit var prefs: SharedPreferences
    private var failed = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = getSharedPreferences("av", MODE_PRIVATE)
        title = getString(R.string.app_name)

        val root = FrameLayout(this)
        root.setBackgroundColor(Color.parseColor("#111114"))

        web = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#111114"))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.setSupportZoom(false)
            settings.builtInZoomControls = false
            settings.useWideViewPort = true          // honour the page's viewport tag (it sets device-width)
            settings.loadWithOverviewMode = false
            // the page's own title ("<TV name> - AV Info") becomes the app's title
            webChromeClient = object : WebChromeClient() {
                override fun onReceivedTitle(view: WebView, t: String?) {
                    if (!t.isNullOrBlank() && !t.startsWith("http")) this@MainActivity.title = t
                }
            }
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val url = request.url
                    val tv = Uri.parse(baseUrl() ?: return false)
                    if (url.host == tv.host) return false          // stay inside the app for the TV's own pages
                    startActivity(Intent(Intent.ACTION_VIEW, url))  // anything else opens in the browser
                    return true
                }

                override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                    failed = false
                }

                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                    if (request.isForMainFrame) showError()
                }

                override fun onPageFinished(view: WebView, url: String?) {
                    if (!failed) errorBox.visibility = View.GONE
                }
            }
        }
        root.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        errorText = TextView(this).apply {
            setTextColor(Color.parseColor("#eeeeee"))
            textSize = 17f
            gravity = Gravity.CENTER
        }
        val retry = Button(this).apply { text = "Try again"; setOnClickListener { load("/status") } }
        val change = Button(this).apply { text = "Change TV address"; setOnClickListener { askAddress(false) } }
        errorBox = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(48, 48, 48, 48)
            setBackgroundColor(Color.parseColor("#111114"))
            visibility = View.GONE
            addView(errorText)
            addView(retry)
            addView(change)
        }
        root.addView(errorBox, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState)
        } else if (baseUrl() == null) {
            askAddress(true)
        } else {
            load("/status")
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    /** "192.168.1.50", "192.168.1.50:41101" or a pasted URL all become http://host:port. */
    private fun normalise(input: String): String? {
        var s = input.trim().lowercase()
        s = s.removePrefix("http://").removePrefix("https://")
        s = s.substringBefore('/')
        if (s.isEmpty() || !Regex("^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$").matches(s)) return null
        if (!s.contains(':')) s += ":41101"
        return "http://$s"
    }

    private fun baseUrl(): String? = prefs.getString("tv", null)

    private fun load(path: String) {
        val base = baseUrl() ?: return askAddress(true)
        failed = false
        errorBox.visibility = View.GONE
        web.loadUrl(base + path)
    }

    private fun showError() {
        failed = true
        errorText.text = "Can't reach the AV Overlay at\n${baseUrl()}\n\nCheck that this phone is on the home Wi-Fi, that the TV is on, and the address."
        errorBox.visibility = View.VISIBLE
    }

    private fun askAddress(first: Boolean) {
        val field = EditText(this).apply {
            hint = "TV address, e.g. 192.168.1.50"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setText(baseUrl()?.removePrefix("http://")?.removeSuffix(":41101") ?: "")
            setSingleLine(true)
        }
        val dialog = AlertDialog.Builder(this)
            .setTitle("TV address")
            .setMessage("The IP address of your LG TV (the overlay's pages are on port 41101).")
            .setView(field)
            .setCancelable(!first)
            .setPositiveButton("Connect", null)
            .apply { if (!first) setNegativeButton("Cancel", null) }
            .create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val n = normalise(field.text.toString())
                if (n == null) {
                    field.error = "Enter an IP address or hostname"
                } else {
                    prefs.edit().putString("tv", n).apply()
                    dialog.dismiss()
                    load("/status")
                }
            }
        }
        dialog.show()
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menu.add(0, 1, 0, "Status")
        menu.add(0, 2, 1, "Setup")
        menu.add(0, 3, 2, "Reload")
        menu.add(0, 4, 3, "Change TV address")
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        when (item.itemId) {
            1 -> load("/status")
            2 -> load("/setup")
            3 -> if (web.url.isNullOrEmpty()) load("/status") else web.reload()
            4 -> askAddress(false)
            else -> return super.onOptionsItemSelected(item)
        }
        return true
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }
}
