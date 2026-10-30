package com.folio.poc.navigation

import android.content.Context
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.viewevent.EventDispatcher

class FolioDialogAction : Record {
    @Field var id: String = ""
    @Field var label: String = ""
    @Field var destructive: Boolean = false
}

class FolioMaterialDialogView(context: Context, appContext: AppContext) : FolioGlassView(context, appContext) {
    var visible by mutableStateOf(false)
    var title by mutableStateOf("")
    var message by mutableStateOf("")
    var actions by mutableStateOf(emptyList<FolioDialogAction>())
    private val onSelect by EventDispatcher()
    private val onDismiss by EventDispatcher()
    @Composable override fun GlassContent() = Unit
    @Composable override fun MaterialContent() {
        if (!visible) return
        AlertDialog(onDismissRequest = { if (visible) { visible = false; onDismiss(payload()) } }, title = { Text(title) }, text = { Text(message) },
            confirmButton = { FlowRow(horizontalArrangement = Arrangement.End) {
                actions.forEach { action -> TextButton(onClick = { if (visible) { visible = false; onSelect(payload("id" to action.id)) } },
                    colors = ButtonDefaults.textButtonColors(contentColor = if (action.destructive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)) {
                    Text(action.label)
                } }
            } })
    }
}

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
class FolioMaterialButtonView(context: Context, appContext: AppContext) : FolioGlassView(context, appContext) {
    var systemImage by mutableStateOf("")
    var label by mutableStateOf("")
    var primary by mutableStateOf(false)
    var destructive by mutableStateOf(false)
    private val onPress by EventDispatcher()
    @Composable override fun GlassContent() = Unit
    @Composable override fun MaterialContent() {
        val color = if (destructive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary
        if (primary) Button(onClick = { if (controlEnabled) onPress(payload()) }, enabled = controlEnabled,
            shapes = ButtonDefaults.shapes(), colors = ButtonDefaults.buttonColors(containerColor = color, contentColor = if (destructive) MaterialTheme.colorScheme.onError else MaterialTheme.colorScheme.onPrimary), modifier = Modifier.fillMaxSize()) {
                if (systemImage.isNotBlank()) { FolioMaterialIcon(systemImage); Spacer(Modifier.width(8.dp)) }
                Text(label)
            }
        else FilledTonalButton(onClick = { if (controlEnabled) onPress(payload()) }, enabled = controlEnabled,
            shapes = ButtonDefaults.shapes(), colors = ButtonDefaults.filledTonalButtonColors(contentColor = if (destructive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSecondaryContainer), modifier = Modifier.fillMaxSize()) {
                if (systemImage.isNotBlank()) { FolioMaterialIcon(systemImage); Spacer(Modifier.width(8.dp)) }
                Text(label)
            }
    }
}

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
class FolioMaterialProgressView(context: Context, appContext: AppContext) : FolioGlassView(context, appContext) {
    var indicatorColor by mutableStateOf("")
    @Composable override fun GlassContent() = Unit
    @Composable override fun MaterialContent() {
        LoadingIndicator(modifier = Modifier.fillMaxSize(), color = indicatorColor.glassColor(MaterialTheme.colorScheme.primary))
    }
}
