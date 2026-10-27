package com.folio.poc.navigation

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

// 顶栏颜色沿用 RN 语义主题。
class FolioViewMenuColors : Record {
    @Field var label: String = ""
    @Field var secondary: String = ""
    @Field var muted: String = ""
    @Field var accent: String = ""
    @Field var tab: String = ""
    @Field var border: String = ""
    @Field var backButtonBorder: String = "#E4E4E4"
    @Field var raised: String = ""
    @Field var shadow: String = "#000000"
    @Field var scrim: Int = android.graphics.Color.TRANSPARENT
    @Field var buttonSurface: String = "#F7F7F7"
    @Field var buttonSurfaceOpacity: Float = 1f
    @Field var buttonPressed: String = "#FFFFFF"
    @Field var buttonPressedLabel: String = "#1A1A1A"
}

// 顶栏文案由共享语言目录提供。
class FolioHeaderLabels : Record {
    @Field var search: String = ""
    @Field var searchPlaceholder: String = ""
    @Field var clearSearch: String = ""
    @Field var filter: String = ""
    @Field var importFonts: String = ""
    @Field var loadingImport: String = ""
    @Field var viewOptions: String = ""
    @Field var viewMode: String = ""
    @Field var gridView: String = ""
    @Field var listView: String = ""
    @Field var expanded: String = ""
    @Field var collapsed: String = ""
}

class FolioPresetMenuLabels : Record {
    @Field var title: String = ""
    @Field var value: String = ""
    @Field var expanded: String = ""
    @Field var collapsed: String = ""
}
