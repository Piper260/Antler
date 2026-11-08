module.exports = [
    {
        ignores: ["dist/**", "node_modules/**", "coverage/**"]
    },
    {
        files: ["**/*.js"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "commonjs",
            globals: {
                window: "readonly",
                document: "readonly",
                console: "readonly",
                module: "readonly",
                require: "readonly",
                process: "readonly",
                __dirname: "readonly",
                setTimeout: "readonly",
                clearTimeout: "readonly",
                setInterval: "readonly",
                clearInterval: "readonly",
                fetch: "readonly",
                Buffer: "readonly",
                AbortController: "readonly",
                AbortSignal: "readonly",
                Blob: "readonly",
                CSS: "readonly",
                TextDecoder: "readonly",
                URL: "readonly",
                IntersectionObserver: "readonly",
                alert: "readonly",
                confirm: "readonly",
                localStorage: "readonly",
                navigator: "readonly",
                performance: "readonly",
                requestAnimationFrame: "readonly",
                cancelAnimationFrame: "readonly"
            }
        },
        rules: {
            "no-unused-vars": "warn",
            "no-undef": "warn"
        }
    },
    {
        files: ["src/renderer/**/*.js"],
        languageOptions: {
            sourceType: "module"
        }
    }
];
