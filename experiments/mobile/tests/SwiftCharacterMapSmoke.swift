import Foundation

// 验证生成绑定的字符表契约与只读快照生命周期。
enum SwiftCharacterMapSmoke {
    static func run(engine: FolioEngine, faces: [FaceSummaryDto]) throws {
        for face in faces.filter({ $0.faceIndex == 1 || $0.isVariable || $0.format == "OTF" }) {
            let opened = try object(engine.openCharacterMap(request: json([
                "faceId": face.id.value, "revisionId": face.revisionId, "sourcePath": face.sourcePath!
            ])))
            let handle = opened["handle"] as! String
            precondition((opened["faceIndex"] as! NSNumber).uint32Value == face.faceIndex)
            precondition((opened["count"] as! Int) > 256)
            let page = try object(engine.queryCharacterMap(request: json(["handle": handle])))
            let entries = page["entries"] as! [[String: Any]]
            precondition(entries.count == 256)
            let query = try object(engine.queryCharacterMap(request: json(["handle": handle, "text": "U+0041"])))
            let entry = (query["entries"] as! [[String: Any]])[0]
            precondition(entry["codepoint"] as! Int == 65)
            precondition(entry["script"] as! String == "Latin")
            let axes = Dictionary(uniqueKeysWithValues: face.axes.map { ($0.tag, $0.defaultValue) })
            let rendered = try engine.renderCharacterMap(request: json([
                "handle": handle, "glyphIds": [entry["glyphId"]!], "axes": axes,
                "size": 128, "foreground": [20, 40, 60, 255]
            ]))
            let images = try JSONSerialization.jsonObject(with: Data(rendered.utf8)) as! [[String: Any]]
            precondition(images[0]["status"] as! String == "ready")
            let encoded = (images[0]["dataUrl"] as! String).split(separator: ",")[1]
            let png = Data(base64Encoded: String(encoded))!
            precondition(Array(png.prefix(8)) == [137, 80, 78, 71, 13, 10, 26, 10])
            engine.closeCharacterMap(handle: handle)
            do {
                _ = try engine.queryCharacterMap(request: json(["handle": handle]))
                preconditionFailure("关闭后的字符表仍可查询")
            } catch {
                precondition(String(describing: error).contains("characterMap.error.sessionClosed"))
            }
        }
        print("PASS：Swift 字符表打开、默认分页、U+ 搜索、指定字形 PNG 渲染、非零 TTC 成员、变量轴与关闭句柄")
    }

    private static func json(_ value: [String: Any]) throws -> String {
        String(decoding: try JSONSerialization.data(withJSONObject: value), as: UTF8.self)
    }

    private static func object(_ value: String) throws -> [String: Any] {
        try JSONSerialization.jsonObject(with: Data(value.utf8)) as! [String: Any]
    }
}
