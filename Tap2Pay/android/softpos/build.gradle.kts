plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace   = "com.orchestratepay.softpos"
    compileSdk  = 35

    defaultConfig {
        applicationId = "com.orchestratepay.softpos"
        minSdk        = 29           // Android 10 — required for Google Play Integrity API
        targetSdk     = 35
        versionCode   = 1
        versionName   = "1.0.0"
    }

    buildFeatures { viewBinding = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions { jvmTarget = "17" }

    signingConfigs {
        getByName("debug") {
            // Use release keystore in CI — see Makefile
        }
    }
}

dependencies {
    // Shared NFC library
    implementation(project(":nfc-core"))

    // Android core
    implementation("androidx.core:core-ktx:1.13.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.0")

    // Google Play Integrity API — device attestation for SoftPOS
    implementation("com.google.android.play:integrity:1.3.0")

    // HTTP client
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // Shared security prefs
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // Unit tests (JVM — run with ./gradlew :softpos:test)
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.8.0")
}
