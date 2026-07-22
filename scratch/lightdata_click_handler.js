function guardar() {
            ok = true;
            didcliente = ($("#envio_altaIndividual_cliente").val() || "").trim();
            idml = ($("#envio_altaIndividual_idml").val() || "").trim();
            tracking = ($("#envio_altaIndividual_tracking").val() || "").trim();
            fechaventa = ($("#envio_altaIndividual_fechaventa").val() || "").trim().split('/').reverse().join('-') + ' 00:00:00';
            fechagestionr = "";
            enviovalor = ($("#envio_altaIndividual_valor").val() || "").trim();
            pesoenvio = ($("#envio_altaIndividual_pesototal").val() || "").trim();
            // tiposervicio = $("#envio_altaIndividual_servicio").val();
            provincia = ($("#envio_altaIndividual_direccion_provincia").val() || "").trim();
            localidad = ($("#envio_altaIndividual_direccion_localidad").val() || "").trim();
            calle = ($("#envio_altaIndividual_direccion_calle").val() || "").trim();
            numero = ($("#envio_altaIndividual_direccion_numero").val() || "").trim();
            lat = ($("#envio_altaIndividual_direccion_latitud").val() || "").trim();
            long = ($("#envio_altaIndividual_direccion_longitud").val() || "").trim();
            costoenvio = ($("#envio_altaIndividual_costoenvio").val() || "").trim();
            deadline = ($("#envio_altaIndividual_deadline").val() || "").trim();
            destinatarionombre = ($("#envio_altaIndividual_destinatario_nombre").val() || "").trim();
            destinatariotelefono = ($("#envio_altaIndividual_destinatario_telefono").val() || "").trim();
            destination_receiver_email = ($("#envio_altaIndividual_destinatario_email").val() || "").trim();
            referencia = ($("#envio_altaIndividual_referencia").val() || "").trim();
            obs = ($("#envio_altaIndividual_observacion").val() || "").trim();
            // detallesProducto = $("#envio_altaIndividual_datosProducto").val();
            tamaño = "";
            bultos = ($("#envio_altaIndividual_bultos").val() || "").trim();
            if (bultos == "") {
                bultos = 1;
            }
                            cp = ($("#envio_altaIndividual_direccion_localidad").val() || "").trim();
                localidad = $("#envio_altaIndividual_direccion_localidad option:selected").text().trim();
            
            prioridad = $("#tengoPriori").prop("checked") ? 1 : 0;

            tengoHorario = $("#tengoHorario").prop("checked") ? 1 : 0;

            hsDesde = $("#entregaDesde").val();
            hsHasta = $("#entregaHasta").val();
            if (typeof hsDesde == "undefined") {
                hsDesde = "";
            }

            if (typeof hsHasta == "undefined") {
                hsHasta = "";
            }


            
            $(".altaIobli").each(function() {
                if (($(this).val() || "").trim() == "") {
                    $("#" + this["id"] + "").css("border", "2.5px solid #C70000");
                    $("label[for='" + this["id"] + "']").css("color", "#C70000");
                    $("#msjCamposObligatorios").html("<p>Los campos con (*) son obligatorios | <span style='color: #C70000;'>Complete todos los campos obligatorios por favor</span></p>")
                    faltanCampos = true
                    ok = false;
                }
            });

            if (!ok) {
                Swal.fire({
                    title: "Complete todos los campos obligatorios",
                    text: "Los campos con (*) son obligatorios",
                    icon: "warning",
                    iconColor: "#C70000",
                    confirmButtonText: "Volver",
                    confirmButtonColor: "#7117EB",
                })
                return false;
            }


            Acobranzas = [];
            if (typeof(appSystemCobranzas) != "undefined") {

                for (n in camposcobranzas) {
                    didcampo = camposcobranzas[n]["did"];
                    valor = ($("#campocobranza_envio_individual_" + didcampo).val() || "").trim();
                    aux = {
                        "campo": didcampo,
                        "valor": valor
                    };
                    Acobranzas.push(aux);
                }

            }

            if (Acobranzas.length > 0) {
                let invalido = false

                Acobranzas.forEach(campo => {
                    if (campo.valor != "" && !regexCP.test(campo.valor)) {
                        invalido = true
                    }
                });

                if (invalido) {
                    Swal.fire({
                        title: "En los campos cobranza solo se admiten numeros",
                        text: "Debe modificarlo para continuar",
                        icon: "warning",
                        iconColor: "#E18700",
                        confirmButtonText: "Volver",
                        confirmButtonColor: "#7117EB",
                    })
                    return false;
                }
            }

            Ace = [];
            $(".campoace_subidaindividual").each(function() {
                didce = $(this).attr("data-did");
                val = ($("#campoace_envio_individual_" + didce).val() || "").trim();
                if (val != "") {
                    aux = {
                        "campo": didce,
                        "valor": val
                    };
                    Ace.push(aux);
                }
            })

            Alogisticas = [];
            if (typeof(appSystemLogisticaInversa) != "undefined") {

                for (n in camposlogisticas) {
                    didcampo = camposlogisticas[n]["did"];
                    valor = ($("#campologistica_envio_individual_" + didcampo).val() || "").trim();
                    aux = {
                        "campo": didcampo,
                        "valor": valor
                    };
                    Alogisticas.push(aux);
                }

            }

            if (destinatarionombre == "") {
                Swal.fire({
                    title: "El paquete debe tener nombre de destinatario",
                    icon: "warning",
                    iconColor: "#C70000",
                    confirmButtonText: "Volver",
                    confirmButtonColor: "#7117EB",
                })
                return false;
            }

            if (didcliente == "" || didcliente == null || didcliente == undefined) {
                swal({
                    title: 'Debe seleccionar un cliente antes de subir el envio',
                    icon: 'error'
                });
                return false;
            }

            Swal.fire({
                title: "Estas seguro de subir el envio ?",
                icon: "warning",
                iconColor: "#7117eb",
                showCancelButton: true,
                confirmButtonText: "Si, subir",
                cancelButtonText: `Volver`,
                confirmButtonColor: "#009b39",
                cancelButtonColor: "#7117eb",
            }).then((result) => {
                if (result.isConfirmed) {

                    address_line = (calle && numero) ? calle + " " + numero : (calle ? calle : numero);

                    const data = {
                        "idEmpresa": 61,
                        "estado": 1,
                        "flex": 0,
                        "ml_shipment_id": tracking,
                        "ml_venta_id": idml,
                        "didCliente": didcliente,
                        "destination_receiver_email": destination_receiver_email,
                        "destination_receiver_name": destinatarionombre,
                        "destination_receiver_phone": destinatariotelefono,
                        "destination_shipping_street_name": calle,
                        "destination_shipping_street_number": numero,
                        "destination_shipping_address_line": address_line,
                        "destination_city_name": localidad,
                        "destination_shipping_zip_code": cp,
                        "destination_state_name": provincia,
                        "fecha_venta": fechaventa,
                        "peso": pesoenvio,
                        "valor_declarado": enviovalor,
                        "obs": obs,
                        "destination_comments": referencia,
                        "destination_latitude": lat,
                        "destination_longitude": long,
                        "tamaño": tamaño,
                        "bultos": bultos,
                        // "didServicio": tiposervicio,
                        "costo_envio_ml": costoenvio,
                        "tracking_number": tracking,
                        "deadline": deadline,
                        "quien": 108,
                        "perfil": 2,
                        "prioridad": prioridad,
                        "conHorario": tengoHorario,
                        "hora_desde": hsDesde,
                        "hora_hasta": hsHasta,
                        "enviosDireccionesDestino": {
                            "calle": calle,
                            "numero": numero,
                            "address_line": address_line,
                            "cp": cp,
                            "localidad": localidad,
                            "provincia": provincia,
                            "latitud": lat,
                            "longitud": long,
                            "destination_comments": referencia
                        }
                    };

                    // < ?php if ($GLOBAL_empresa_id == 108) { ?>
                    //     data["enviosItems"] = {
                    //         "cantidad": 0,
                    //         "detallesProducto": detallesProducto,
                    //     }
                    // < ?php } ?>

                    if (Acobranzas && Acobranzas.length > 0) {
                        filtradas = Acobranzas.filter((item) => item.valor)
                        if (filtradas.length > 0) {
                            data["envioscobranza"] = filtradas;
                        }
                    }

                    if (Alogisticas && Alogisticas.length > 0) {
                        filtradas = Alogisticas.filter((item) => item.valor)
                        if (filtradas.length > 0) {
                            data["enviosLogisticaInversa"] = filtradas;
                        }
                    }

                    if (Ace && Ace.length > 0) {
                        filtradas = Ace.filter((item) => item.valor)
                        if (filtradas.length > 0) {
                            data["camposExtras"] = filtradas;
                        }
                    }

                    if (costoenvio) {
                        data["costoEnvio"] = {
                            "valor": costoenvio,
                            "nameZonaCostoCliente": "Subido manual"
                        };
                    }

                    if (obs) {
                        data["enviosObservaciones"] = {
                            "observaciones": obs
                        };
                    }

                    parametros = {
                        "data": data
                    };

                    console.log("parametros", parametros);


                    fopenEspera();
                    $.ajax({
                        url: "https://altaenvios.lightdata.com.ar/api/altaEnvio",
                        type: 'POST',
                        //dataType: "json",
                        data: parametros,
                        success: function(result) {
                            g_data = result;
                            if (g_data.estado) {
                                appEnviosFlexIndividual.resetDataALta();
                                swal({
                                    title: 'Actualizado',
                                    icon: 'success'
                                });
                            } else {
                                swal({
                                    title: 'Error al actualizar',
                                    icon: 'error'
                                });
                            }
                            FcloseEspera();
                        },
                        error: function(xhr, status) {
                            FcloseEspera();
                            swal({
                                title: 'Error al actualizar',
                                icon: 'error'
                            });
                        },
                        complete: function(xhr, status) {
                            //FresetDataCliente();
                            //swal({title: 'Actualizado',icon: 'success'});
                        }
                    });
                }
            })

        }