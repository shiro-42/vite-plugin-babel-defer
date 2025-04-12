# Vite Plugin: Babel Defer

⚠️ Experimental syntax hack. Not for production use.

This plugin adds a new JavaScript syntax to make async code feel cleaner—without turning your entire function into an async soup.

⸻

## ✨ New Syntax

```javascript
defer: data = fetchSomethingAsync()
```

What this does:
- Transforms the lines below into a callback passed to fetchSomethingAsync.
- data becomes the argument passed to that callback.
- Execution resumes only inside the callback once the async function resolves.

Example:

```javascript
console.log('before')
defer: data = fetchSomethingAsync()
console.log('after', data)
```

Transpiles to:

```javascript
console.log('before')
fetchSomethingAsync((data) => {
  console.log('after', data)
})
```

⸻

## 🔁 Multiple defer statements

Yes, you can use more than one. Each `defer:` affects only the code immediately below it. It doesn’t wrap the entire block or function.

Example:

```javascript
defer: user = getUser()
console.log(user)

defer: settings = getSettings()
console.log(settings)
```

Will become:

```javascript
getUser((user) => {
  console.log(user)
  getSettings((settings) => {
    console.log(settings)
  })
})
```

Order matters. Nesting happens naturally.

⸻

## 🧪 Why?

It’s a minimal, callback-first async syntax that avoids wrapping everything in `async/await` or `.then()` chains.
Think of it as structured callback sugar for situations where you want tighter control or just to experiment with a different flow.

⸻

⚠️ Disclaimer

- This is a syntax experiment, not an official proposal.
- Don’t expect tooling, types, or IDE support.
- Just a fun playground if you want to explore different async flows with Babel.

