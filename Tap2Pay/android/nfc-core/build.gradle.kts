plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace   = "com.orchestratepay.nfccore"
    compileSdk  = 35

    defaultConfig {
        minSdk     = 26
        // Library doesn't have a versionCode/versionName — consuming app sets these
        consumerProguardFiles("consumer-rules.pro")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions { jvmTarget = "17" }
    lint {
        targetSdk = 35
    }
    testOptions {
        targetSdk = 35
    }
}

dependencies {
    // Core Android — NFC API is part of the SDK, no extra dep needed
    implementation("androidx.core:core-ktx:1.13.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.0")

    // Crypto — for HMAC-SHA256 token verification
    implementation("com.google.crypto.tink:tink-android:1.13.0")

    // Unit tests
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.mockito:mockito-core:5.7.0")
    testImplementation("org.mockito.kotlin:mockito-kotlin:5.2.1")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.8.0")
}
